// src/pubg/pubg-match.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PubgApiService } from './pubg-api.service';
import { MatchDataResult, TelemetryKillEventV2, TelemetryEvent } from './pubg.interfaces';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';

@Injectable()
export class PubgMatchService {
  private readonly GAME_DATA_DIR: string;
  private readonly MATCH_DATA_SUBDIR = 'match-data';
  private readonly TELEMETRY_DATA_SUBDIR = 'telemetry-data';

  constructor(
    private prisma: PrismaService,
    private pubgApi: PubgApiService,
    private configService: ConfigService,
    private logger: DualOutputLoggerService,
  ) {
    this.GAME_DATA_DIR = this.configService.get<string>('GAME_DATA_DIR', './game-data');
  }

  /**
   * 获取比赛原始数据（主入口）
   * @param matchId 比赛 ID
   * @returns 比赛数据
   */
  async getMatchOriginalData(matchId: string): Promise<MatchDataResult> {
    try {
      const paths = this.getMatchPaths(matchId);
      this.ensureDirectoriesExist(paths);

      // 优先从本地读取
      const localData = await this.readLocalMatchData(matchId, paths);
      if (localData) {
        return localData;
      }

      // 本地不存在，从API获取
      return await this.fetchMatchDataFromApi(matchId, paths);
    } catch (error) {
      this.logger.error(`Error getting match data for ${matchId}:`, error);
      throw error;
    }
  }

  /**
   * 获取比赛相关文件路径
   */
  private getMatchPaths(matchId: string, dateStr?: string): { matchDir: string; telemetryDir: string; matchFilePath: string; telemetryFilePath: string; dataFileName: string } {
    const matchBaseDir = path.join(this.GAME_DATA_DIR, this.MATCH_DATA_SUBDIR);
    const telemetryBaseDir = path.join(this.GAME_DATA_DIR, this.TELEMETRY_DATA_SUBDIR);
    const dataFileName = `${matchId}.json`;

    if (dateStr) {
      const matchDir = path.join(matchBaseDir, dateStr);
      const telemetryDir = path.join(telemetryBaseDir, dateStr);
      return {
        matchDir,
        telemetryDir,
        matchFilePath: path.join(matchDir, dataFileName),
        telemetryFilePath: path.join(telemetryDir, dataFileName),
        dataFileName,
      };
    }

    return {
      matchDir: matchBaseDir,
      telemetryDir: telemetryBaseDir,
      matchFilePath: path.join(matchBaseDir, dataFileName),
      telemetryFilePath: path.join(telemetryBaseDir, dataFileName),
      dataFileName,
    };
  }

  /**
   * 从比赛数据中提取日期字符串 (YYYY-MM-DD)
   */
  private extractDateFromMatchData(matchData: any): string {
    try {
      const createdAt = matchData.data?.attributes?.createdAt;
      if (createdAt) {
        const tz = this.configService.get<string>('TZ', 'Asia/Shanghai');
        const date = new Date(createdAt);
        return date.toLocaleDateString('sv-SE', { timeZone: tz });
      }
    } catch (error) {
      this.logger.warn(`Failed to extract date from match data:`, error);
    }
    return '';
  }

  /**
   * 确保目录存在
   */
  private ensureDirectoriesExist(paths: { matchDir: string; telemetryDir: string }): void {
    if (!fs.existsSync(paths.matchDir)) {
      fs.mkdirSync(paths.matchDir, { recursive: true });
    }
    if (!fs.existsSync(paths.telemetryDir)) {
      fs.mkdirSync(paths.telemetryDir, { recursive: true });
    }
  }

  /**
   * 查找比赛文件（支持按日期文件夹搜索）
   */
  private findMatchFile(baseDir: string, fileName: string): string | null {
    const directPath = path.join(baseDir, fileName);
    if (fs.existsSync(directPath)) {
      return directPath;
    }

    if (!fs.existsSync(baseDir)) {
      return null;
    }

    const dateDirs = fs.readdirSync(baseDir).filter(f => {
      const fullPath = path.join(baseDir, f);
      return fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(f);
    });

    for (const dateDir of dateDirs) {
      const filePath = path.join(baseDir, dateDir, fileName);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * 读取本地比赛数据
   */
  private async readLocalMatchData(matchId: string, paths: { matchFilePath: string; telemetryFilePath: string }): Promise<MatchDataResult | null> {
    try {
      const matchBaseDir = path.join(this.GAME_DATA_DIR, this.MATCH_DATA_SUBDIR);
      const telemetryBaseDir = path.join(this.GAME_DATA_DIR, this.TELEMETRY_DATA_SUBDIR);
      const dataFileName = `${matchId}.json`;

      const matchFile = this.findMatchFile(matchBaseDir, dataFileName);
      const telemetryFile = this.findMatchFile(telemetryBaseDir, dataFileName);

      if (matchFile && telemetryFile) {
        const matchData = JSON.parse(fs.readFileSync(matchFile, 'utf-8'));
        const telemetryEvents = JSON.parse(fs.readFileSync(telemetryFile, 'utf-8'));
        
        this.logger.log(`Loaded match data from local files for ${matchId}`);
        
        return {
          attributes: matchData.data.attributes,
          telemetryEvents,
          dataPath: matchFile,
        };
      }
      return null;
    } catch (error) {
      this.logger.warn(`Failed to read local match data for ${matchId}:`, error);
      return null;
    }
  }

  /**
   * 从API获取比赛数据
   */
  private async fetchMatchDataFromApi(matchId: string, paths: { matchFilePath: string; telemetryFilePath: string }): Promise<MatchDataResult> {
    const matchData = await this.pubgApi.getMatch(matchId);
    
    let telemetryUrl: string | undefined;
    const included = matchData.included || [];
    for (const item of included) {
      if (item.type === 'asset' && item.attributes?.name === 'telemetry') {
        telemetryUrl = item.attributes.URL;
        break;
      }
    }
    
    const telemetryEvents = telemetryUrl ? await this.pubgApi.getMatchTelemetry(telemetryUrl) : [];
    
    const dateStr = this.extractDateFromMatchData(matchData);
    const datedPaths = this.getMatchPaths(matchId, dateStr);
    this.ensureDirectoriesExist(datedPaths);
    
    await this.saveMatchData(matchData, telemetryEvents, datedPaths);
    
    return {
      attributes: matchData.data.attributes,
      telemetryEvents,
      dataPath: datedPaths.matchFilePath,
    };
  }

  /**
   * 保存比赛数据到本地
   */
  private async saveMatchData(matchData: any, telemetryEvents: any[], paths: { matchFilePath: string; telemetryFilePath: string }): Promise<void> {
    fs.writeFileSync(paths.matchFilePath, JSON.stringify({ data: matchData.data, included: matchData.included }, null, 2));
    this.logger.log(`Saved match data to: ${paths.matchFilePath}`);

    fs.writeFileSync(paths.telemetryFilePath, JSON.stringify(telemetryEvents, null, 2));
    this.logger.log(`Saved telemetry data to: ${paths.telemetryFilePath}`);
  }

  /**
   * 保存比赛到数据库
   */
  async saveMatch(matchId: string, matchData: MatchDataResult): Promise<any> {
    return this.prisma.match.upsert({
      where: { id: matchId },
      update: {
        gameMode: matchData.attributes.gameMode,
        mapName: matchData.attributes.mapName,
        playedAt: new Date(matchData.attributes.createdAt),
        updatedAt: new Date(),
      },
      create: {
        id: matchId,
        gameMode: matchData.attributes.gameMode,
        mapName: matchData.attributes.mapName,
        playedAt: new Date(matchData.attributes.createdAt),
      },
    });
  }

  /**
   * 通过用户 ID 获取历史对局数据（最近14天的所有比赛）
   * @param userId 用户 ID
   * @returns 比赛 ID 列表
   */
  async getUserMatchHistory(userId: string): Promise<string[]> {
    return this.pubgApi.getPlayerMatches(userId);
  }

  /**
   * 获取本地存储的所有 match 文件
   * @returns matchId 列表
   */
  getLocalMatchFiles(): string[] {
    const matchDir = path.join(this.GAME_DATA_DIR, this.MATCH_DATA_SUBDIR);
    
    if (!fs.existsSync(matchDir)) {
      return [];
    }
    
    const matchIds: string[] = [];
    
    const entries = fs.readdirSync(matchDir);
    for (const entry of entries) {
      const fullPath = path.join(matchDir, entry);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry)) {
        const files = fs.readdirSync(fullPath);
        files
          .filter(file => file.endsWith('.json'))
          .forEach(file => matchIds.push(file.replace('.json', '')));
      } else if (stat.isFile() && entry.endsWith('.json')) {
        matchIds.push(entry.replace('.json', ''));
      }
    }
    
    return matchIds;
  }

  /**
   * 解析单个击杀事件
   */
  private parseKillEvent(event: TelemetryKillEventV2): { killerId: string; killerName: string; victimId: string; victimName: string; weaponId: string; distance: number; isHeadshot: boolean; timestamp: Date } | null {
    let killerId: string;
    let killerName: string;
    let victimId: string;
    let victimName: string;
    let weaponId: string;
    let distance: number;
    let isHeadshot: boolean;
    let timestamp: Date;

    if (event._T === 'LogPlayerKillV2') {
      killerId = event.killer?.accountId || '';
      killerName = event.killer?.name || '';
      victimId = event.victim?.accountId || '';
      victimName = event.victim?.name || '';
      weaponId = event.finishDamageInfo?.damageCauserName || event.killerDamageInfo?.damageCauserName || 'Unknown';
      distance = event.finishDamageInfo?.distance || event.killerDamageInfo?.distance || 0;
      isHeadshot = event.finishDamageInfo?.damageReason === 'HeadShot' || event.killerDamageInfo?.damageReason === 'HeadShot';
      timestamp = new Date(event._D);
    } else {
      killerId = event.character?.accountId || '';
      killerName = event.character?.name || '';
      victimId = event.victim?.accountId || '';
      victimName = event.victim?.name || '';
      weaponId = event.weapon?.weaponId || event.weapon?.weaponClass || 'Unknown';
      distance = event.distance || 0;
      isHeadshot = event.isHeadshot || false;
      timestamp = new Date(event.timestamp || event._D);
    }

    if (!killerId || !victimId) {
      return null;
    }

    return { killerId, killerName, victimId, victimName, weaponId, distance, isHeadshot, timestamp };
  }

  /**
   * 解析遥测数据中的击杀事件并保存到数据库
   * @param matchId 比赛 ID
   * @param telemetryEvents 遥测事件数组
   */
  async parseAndSaveKillEvents(matchId: string, telemetryEvents: TelemetryEvent[]): Promise<void> {
    try {
      const killEvents = telemetryEvents.filter(event =>
        event._T === 'LogPlayerKillV2' || event._T === 'LogPlayerKill'
      ) as TelemetryKillEventV2[];

      if (killEvents.length === 0) {
        this.logger.log(`No kill events found in telemetry for match ${matchId}`);
        return;
      }

      this.logger.log(`Found ${killEvents.length} kill events in telemetry for match ${matchId}`);

      const parsedEvents = killEvents
        .map(event => this.parseKillEvent(event))
        .filter((parsed): parsed is NonNullable<typeof parsed> => parsed !== null);

      if (parsedEvents.length === 0) {
        this.logger.log(`No valid kill events found for match ${matchId}`);
        return;
      }

      await this.prisma.$transaction(async (tx) => {
        for (const parsed of parsedEvents) {
          await tx.killEvent.upsert({
            where: {
              matchId_killerId_victimId_timestamp: {
                matchId,
                killerId: parsed.killerId,
                victimId: parsed.victimId,
                timestamp: parsed.timestamp,
              },
            },
            update: {
              killerName: parsed.killerName,
              victimName: parsed.victimName,
              weaponId: parsed.weaponId,
              distance: parsed.distance,
              isHeadshot: parsed.isHeadshot,
            },
            create: {
              matchId,
              killerId: parsed.killerId,
              killerName: parsed.killerName,
              victimId: parsed.victimId,
              victimName: parsed.victimName,
              weaponId: parsed.weaponId,
              distance: parsed.distance,
              isHeadshot: parsed.isHeadshot,
              timestamp: parsed.timestamp,
            },
          });
        }
      });

      this.logger.log(`Successfully saved ${parsedEvents.length} kill events for match ${matchId}`);
    } catch (error) {
      this.logger.error(`Error parsing kill events for match ${matchId}:`, error);
      throw error;
    }
  }

  /**
   * 处理遥测数据
   * @param userId 用户 ID
   * @param matchId 比赛 ID
   */
  async processTelemetryData(userId: string, matchId: string): Promise<void> {
    try {
      // 获取比赛数据（内部会自动解析击杀事件）
      await this.getMatchOriginalData(matchId);

      this.logger.log(`Processed telemetry data for match ${matchId}`);
    } catch (error) {
      this.logger.error(`Error processing telemetry data for match ${matchId}:`, error);
      throw error;
    }
  }

  /**
   * 重解析单场比赛遥测数据
   */
  async reparseMatchTelemetry(matchId: string, taskId?: string): Promise<{ success: boolean; matchId: string; message: string }> {
    try {
      const matchBaseDir = path.join(this.GAME_DATA_DIR, this.MATCH_DATA_SUBDIR);
      const telemetryBaseDir = path.join(this.GAME_DATA_DIR, this.TELEMETRY_DATA_SUBDIR);
      const dataFileName = `${matchId}.json`;

      const matchFile = this.findMatchFile(matchBaseDir, dataFileName);
      const telemetryFile = this.findMatchFile(telemetryBaseDir, dataFileName);

      if (matchFile) {
        fs.unlinkSync(matchFile);
      }
      if (telemetryFile) {
        fs.unlinkSync(telemetryFile);
      }

      await this.getMatchOriginalData(matchId);
      
      const newTelemetryFile = this.findMatchFile(telemetryBaseDir, dataFileName);
      if (newTelemetryFile) {
        const telemetryEvents = JSON.parse(fs.readFileSync(newTelemetryFile, 'utf-8'));
        await this.parseAndSaveKillEvents(matchId, telemetryEvents);
      }

      if (taskId) {
        await this.prisma.task.update({
          where: { id: taskId },
          data: { progress: 100 },
        });
      }

      return { success: true, matchId, message: 'Match telemetry reparse completed' };
    } catch (error) {
      this.logger.error(`Error reparsing match telemetry for ${matchId}:`, error);
      return { success: false, matchId, message: error.message || 'Unknown error' };
    }
  }

  /**
   * 重解析用户所有比赛遥测数据（带进度回调）
   */
  async reparseUserTelemetryWithProgress(
    userId: string,
    progressCallback: (current: number, total: number, percentage: number) => Promise<void>,
  ): Promise<{ success: boolean; message: string; totalMatches: number; processedMatches: number; userId: string }> {
    try {
      const matchIds = await this.getUserMatchHistory(userId);
      const totalMatches = matchIds.length;
      let processedMatches = 0;

      for (const matchId of matchIds) {
        try {
          await this.reparseMatchTelemetry(matchId);
          processedMatches++;
        } catch (error) {
          this.logger.warn(`Failed to reparse match ${matchId}: ${error.message}`);
        }
        
        await progressCallback(processedMatches, totalMatches, Math.round((processedMatches / totalMatches) * 100));
      }

      return { success: true, message: `User telemetry reparse completed: ${processedMatches}/${totalMatches} matches`, totalMatches, processedMatches, userId };
    } catch (error) {
      this.logger.error(`Error reparsing user telemetry for ${userId}:`, error);
      return { success: false, message: error.message || 'Unknown error', totalMatches: 0, processedMatches: 0, userId };
    }
  }

  /**
   * 重解析所有用户比赛遥测数据（带进度回调）
   */
  async reparseAllTelemetryWithProgress(
    progressCallback: (current: number, total: number, percentage: number) => Promise<void>,
  ): Promise<{ success: boolean; message: string; totalUsers: number; processedUsers: number; totalMatches: number; processedMatches: number }> {
    try {
      const users = await this.prisma.user.findMany({ select: { pubgId: true } });
      const totalUsers = users.length;
      let processedUsers = 0;
      let totalMatches = 0;
      let processedMatches = 0;

      for (const user of users) {
        try {
          const matchIds = await this.getUserMatchHistory(user.pubgId);
          totalMatches += matchIds.length;

          for (const matchId of matchIds) {
            try {
              await this.reparseMatchTelemetry(matchId);
              processedMatches++;
            } catch (error) {
              this.logger.warn(`Failed to reparse match ${matchId}: ${error.message}`);
            }
          }

          processedUsers++;
        } catch (error) {
          this.logger.warn(`Failed to process user ${user.pubgId}: ${error.message}`);
          processedUsers++;
        }
        
        await progressCallback(processedUsers, totalUsers, Math.round((processedUsers / totalUsers) * 100));
      }

      return { success: true, message: `All telemetry reparse completed: ${processedUsers}/${totalUsers} users, ${processedMatches}/${totalMatches} matches`, totalUsers, processedUsers, totalMatches, processedMatches };
    } catch (error) {
      this.logger.error('Error reparsing all telemetry:', error);
      return { success: false, message: error.message || 'Unknown error', totalUsers: 0, processedUsers: 0, totalMatches: 0, processedMatches: 0 };
    }
  }
}