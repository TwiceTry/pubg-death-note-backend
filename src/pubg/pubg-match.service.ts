// src/pubg/pubg-match.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PubgApiService } from './pubg-api.service';
import { MatchDataResult, TelemetryKillEventV2, TelemetryEvent } from './pubg.interfaces';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { TaskService } from '../task/task.service';
import { ExecutableTask, getCurrentTaskContext } from '../task/task.decorator';

interface MatchPaths {
  matchDir: string;
  telemetryDir: string;
  matchFilePath: string;
  telemetryFilePath: string;
  dataFileName: string;
}

@Injectable()
export class PubgMatchService {
  private readonly matchBaseDir: string;
  private readonly telemetryBaseDir: string;

  constructor(
    private prisma: PrismaService,
    private pubgApi: PubgApiService,
    private configService: ConfigService,
    private taskService: TaskService,
    private logger: DualOutputLoggerService,
  ) {
    const gameDataDir = this.configService.get<string>('GAME_DATA_DIR', './game-data');
    this.matchBaseDir = path.join(gameDataDir, 'match-data');
    this.telemetryBaseDir = path.join(gameDataDir, 'telemetry-data');
  }

  // ============================================================
  // 数据获取（主入口）
  // ============================================================

  /**
   * 获取比赛原始数据
   * 优先从本地缓存读取，不存在则调用 PUBG API 获取并缓存
   */
  async getMatchOriginalData(matchId: string): Promise<MatchDataResult> {
    const paths = this.getMatchPaths(matchId);
    this.ensureDirectoriesExist(paths);

    const localData = await this.readLocalMatchData(matchId, paths);
    if (localData) {
      return localData;
    }

    return this.fetchMatchDataFromApi(matchId);
  }

  /**
   * 强制从 API 获取比赛原始数据（跳过本地缓存）
   */
  async fetchMatchDataFromApi(matchId: string): Promise<MatchDataResult> {
    const matchData = await this.pubgApi.getMatch(matchId);

    const telemetryUrl = (matchData.included || [])
      .find(item => item.type === 'asset' && item.attributes?.name === 'telemetry')
      ?.attributes?.URL;

    const telemetryEvents = telemetryUrl
      ? await this.pubgApi.getMatchTelemetry(telemetryUrl)
      : [];

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

  // ============================================================
  // 本地文件操作
  // ============================================================

  /**
   * 获取本地所有 matchId（支持日期子目录和根目录）
   */
  getLocalMatchFiles(): string[] {
    if (!fs.existsSync(this.matchBaseDir)) {
      return [];
    }

    const matchIds: string[] = [];
    const entries = fs.readdirSync(this.matchBaseDir);

    for (const entry of entries) {
      const fullPath = path.join(this.matchBaseDir, entry);
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
   * 构建比赛文件路径
   * @param dateStr 可选，格式 YYYY-MM-DD，用于按日期分目录存储
   */
  private getMatchPaths(matchId: string, dateStr?: string): MatchPaths {
    const dataFileName = `${matchId}.json`;

    if (dateStr) {
      const matchDir = path.join(this.matchBaseDir, dateStr);
      const telemetryDir = path.join(this.telemetryBaseDir, dateStr);
      return {
        matchDir,
        telemetryDir,
        matchFilePath: path.join(matchDir, dataFileName),
        telemetryFilePath: path.join(telemetryDir, dataFileName),
        dataFileName,
      };
    }

    return {
      matchDir: this.matchBaseDir,
      telemetryDir: this.telemetryBaseDir,
      matchFilePath: path.join(this.matchBaseDir, dataFileName),
      telemetryFilePath: path.join(this.telemetryBaseDir, dataFileName),
      dataFileName,
    };
  }

  /**
   * 查找比赛文件，优先根目录，再遍历日期子目录
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
   * 确保 match 和 telemetry 目录存在
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
   * 从比赛数据中提取日期字符串 (YYYY-MM-DD)
   * 使用时区配置 TZ，默认 Asia/Shanghai
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

  // ============================================================
  // 数据读写（本地缓存）
  // ============================================================

  /**
   * 读取本地缓存的比赛数据
   * @returns 存在则返回 MatchDataResult，不存在返回 null
   */
  private async readLocalMatchData(matchId: string, paths: MatchPaths): Promise<MatchDataResult | null> {
    try {
      const matchFile = this.findMatchFile(this.matchBaseDir, paths.dataFileName);
      const telemetryFile = this.findMatchFile(this.telemetryBaseDir, paths.dataFileName);

      if (matchFile && telemetryFile) {
        const matchData = JSON.parse(fs.readFileSync(matchFile, 'utf-8'));
        const telemetryEvents = JSON.parse(fs.readFileSync(telemetryFile, 'utf-8'));

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
   * 保存比赛数据和遥测数据到本地 JSON 文件
   */
  private async saveMatchData(matchData: any, telemetryEvents: any[], paths: MatchPaths): Promise<void> {
    fs.writeFileSync(paths.matchFilePath, JSON.stringify({ data: matchData.data, included: matchData.included }, null, 2));
    fs.writeFileSync(paths.telemetryFilePath, JSON.stringify(telemetryEvents, null, 2));
  }

  // ============================================================
  // 数据库操作
  // ============================================================

  /**
   * 保存/更新比赛信息到 Match 表
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
   * 解析遥测数据中的击杀事件并保存到 KillEvent 表
   * 解析后会清空 telemetryEvents 数组释放内存
   */
  async parseAndSaveKillEvents(matchId: string, telemetryEvents: TelemetryEvent[]): Promise<void> {
    const killEvents = telemetryEvents.filter(event =>
      event._T === 'LogPlayerKillV2' || event._T === 'LogPlayerKill'
    ) as TelemetryKillEventV2[];

    telemetryEvents.length = 0;

    if (killEvents.length === 0) {
      this.logger.log(`No kill events found in telemetry for match ${matchId}`);
      return;
    }

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
            matchId_victimId_timestamp: {
              matchId,
              victimId: parsed.victimId,
              timestamp: parsed.timestamp,
            },
          },
          update: {
            killerId: parsed.killerId,
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
  }

  /**
   * 解析单个击杀事件
   * 兼容 LogPlayerKillV2 和 LogPlayerKill 两种格式
   * @returns 解析后的击杀事件，victimId 为空时返回 null
   */
  private parseKillEvent(event: TelemetryKillEventV2): {
    killerId: string | null;
    killerName: string | null;
    victimId: string;
    victimName: string;
    weaponId: string;
    distance: number;
    isHeadshot: boolean;
    timestamp: Date;
  } | null {
    let killerId: string | null;
    let killerName: string | null;
    let victimId: string;
    let victimName: string;
    let weaponId: string;
    let distance: number;
    let isHeadshot: boolean;
    let timestamp: Date;

    if (event._T === 'LogPlayerKillV2') {
      killerId = event.killer?.accountId || null;
      killerName = event.killer?.name || null;
      victimId = event.victim?.accountId || '';
      victimName = event.victim?.name || '';
      weaponId = this.getFirstDefined(event.killerDamageInfo?.damageCauserName, event.finishDamageInfo?.damageCauserName);
      distance = event.killerDamageInfo?.distance || event.finishDamageInfo?.distance || 0;
      isHeadshot = event.killerDamageInfo?.damageReason === 'HeadShot' || event.finishDamageInfo?.damageReason === 'HeadShot';
      timestamp = new Date(event._D);
    } else {
      killerId = event.character?.accountId || null;
      killerName = event.character?.name || null;
      victimId = event.victim?.accountId || '';
      victimName = event.victim?.name || '';
      weaponId = this.getFirstDefined(event.weapon?.weaponId, event.weapon?.weaponClass);
      distance = event.distance || 0;
      isHeadshot = event.isHeadshot || false;
      timestamp = new Date(event.timestamp || event._D);
    }

    if (!victimId) {
      return null;
    }

    if (!killerId) {
      weaponId = this.getFirstDefined(event.finishDamageInfo?.damageTypeCategory, event.killerDamageInfo?.damageTypeCategory, weaponId);
    }

    return { killerId, killerName, victimId, victimName, weaponId, distance, isHeadshot, timestamp };
  }

  /**
   * 返回第一个非空字符串
   */
  private getFirstDefined(...values: (string | undefined)[]): string {
    return values.find(v => v !== undefined && v !== '') || 'Unknown';
  }

  /**
   * 从比赛数据中提取所有参与者 playerId 和 ranking
   */
  extractParticipants(matchData: any): Map<string, number> {
    const participants = new Map<string, number>();

    if (matchData.included && Array.isArray(matchData.included)) {
      for (const item of matchData.included) {
        if (item.type === 'participant' && item.attributes?.stats?.playerId) {
          const playerId = item.attributes.stats.playerId;
          const ranking = item.attributes.stats?.ranking;
          participants.set(playerId, ranking || 0);
        }
      }
    }

    return participants;
  }

  // ============================================================
  // 比赛同步
  // ============================================================

  /**
   * 处理单场比赛同步
   * 1. 获取比赛数据（本地或 API）
   * 2. 保存到 Match 表
   * 3. 关联已生成死亡笔记的用户到 UserMatch 表
   * 4. 解析击杀事件到 KillEvent 表
   */
  private async processSingleMatchSync(
    matchId: string,
    deathNoteUserIds: Set<string>,
  ): Promise<{ newMatches: number; updatedMatches: number; newUserMatches: number; newKillEvents: number }> {
    const matchData = await this.getMatchOriginalData(matchId);
    const existingMatch = await this.prisma.match.findUnique({ where: { id: matchId } });

    await this.saveMatch(matchId, matchData);

    const participants = this.extractParticipants(matchData);
    const matchedUsers = Array.from(participants.entries())
      .filter(([userId]) => deathNoteUserIds.has(userId));

    let newUserMatches = 0;
    for (const [userId, ranking] of matchedUsers) {
      await this.prisma.userMatch.upsert({
        where: { userId_matchId: { userId, matchId } },
        update: { ranking },
        create: { userId, matchId, ranking },
      });
      newUserMatches++;
    }

    let newKillEvents = 0;
    if (matchData.telemetryEvents?.length > 0) {
      newKillEvents = matchData.telemetryEvents.filter(event =>
        event._T === 'LogPlayerKillV2' || event._T === 'LogPlayerKill',
      ).length;
      await this.parseAndSaveKillEvents(matchId, matchData.telemetryEvents);
    }

    return {
      newMatches: existingMatch ? 0 : 1,
      updatedMatches: existingMatch ? 1 : 0,
      newUserMatches,
      newKillEvents,
    };
  }

  /**
   * 同步本地所有 match 数据到数据库
   * 遍历本地 game-data 目录，将 match/userMatch/killEvent 同步到数据库
   * 所有操作使用 upsert，重复数据不会重复添加
   */
  @ExecutableTask({
    type: 'sync_local_matches',
    async: true,
    buildResult: (result) => ({
      success: true,
      message: (result as { message?: string })?.message || 'Local match sync completed',
      ...(result as Record<string, unknown>),
    }),
  })
  async syncLocalMatches(): Promise<{ success: boolean; message: string; totalMatches: number; processedMatches: number; newMatches: number; updatedMatches: number; newUserMatches: number; newKillEvents: number }> {
    const localMatchIds = this.getLocalMatchFiles();
    const totalMatches = localMatchIds.length;

    if (totalMatches === 0) {
      return { success: true, message: 'No local match files found', totalMatches: 0, processedMatches: 0, newMatches: 0, updatedMatches: 0, newUserMatches: 0, newKillEvents: 0 };
    }

    const deathNoteUsers = await this.prisma.deathNoteGeneration.findMany({
      where: { isGenerated: true },
      select: { userId: true },
    });
    const deathNoteUserIds = new Set(deathNoteUsers.map(u => u.userId));

    let processedMatches = 0;
    let newMatches = 0;
    let updatedMatches = 0;
    let newUserMatches = 0;
    let newKillEvents = 0;

    for (const matchId of localMatchIds) {
      getCurrentTaskContext()?.checkCancelled();

      try {
        const result = await this.processSingleMatchSync(matchId, deathNoteUserIds);
        newMatches += result.newMatches;
        updatedMatches += result.updatedMatches;
        newUserMatches += result.newUserMatches;
        newKillEvents += result.newKillEvents;
      } catch (error) {
        this.logger.warn(`Failed to sync match ${matchId}: ${error.message}`);
      } finally {
        processedMatches++;
        await getCurrentTaskContext()?.updateProgress(Math.round((processedMatches / totalMatches) * 100));

        if (processedMatches % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    return {
      success: true,
      message: `Local match sync completed: ${processedMatches}/${totalMatches} matches`,
      totalMatches,
      processedMatches,
      newMatches,
      updatedMatches,
      newUserMatches,
      newKillEvents,
    };
  }

  // ============================================================
  // 遥测重解析
  // ============================================================

  /**
   * 获取用户历史比赛 ID 列表（最近 14 天）
   */
  async getUserMatchHistory(userId: string): Promise<string[]> {
    const players = await this.pubgApi.getPlayersByIds(userId);
    return players[0]?.matches || [];
  }

  /**
   * 批量获取多个用户的比赛ID列表
   * 复用 getPlayersByIds 的批量查询能力，每批最多10个用户
   */
  private async getPlayersMatchesBatch(playerIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();

    for (let i = 0; i < playerIds.length; i += 10) {
      const batch = playerIds.slice(i, i + 10);
      const players = await this.pubgApi.getPlayersByIds(batch);

      for (const player of players) {
        result.set(player.id, player.matches || []);
      }
    }

    return result;
  }

  /**
   * 重解析单场比赛遥测数据
   * 删除本地缓存后重新从 API 获取并解析击杀事件
   */
  async reparseMatchTelemetry(matchId: string): Promise<{ success: boolean; matchId: string; message: string }> {
    try {
      const dataFileName = `${matchId}.json`;

      const matchFile = this.findMatchFile(this.matchBaseDir, dataFileName);
      const telemetryFile = this.findMatchFile(this.telemetryBaseDir, dataFileName);

      if (matchFile) {
        fs.unlinkSync(matchFile);
      }
      if (telemetryFile) {
        fs.unlinkSync(telemetryFile);
      }

      const matchData = await this.getMatchOriginalData(matchId);

      if (matchData.telemetryEvents?.length > 0) {
        await this.parseAndSaveKillEvents(matchId, matchData.telemetryEvents);
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
  @ExecutableTask({
    type: 'reparse_user',
    getUserId: (args) => args[0] as string,
    async: true,
    buildResult: (result) => ({
      success: true,
      message: (result as { message?: string })?.message || 'User telemetry reparse completed',
      ...(result as Record<string, unknown>),
    }),
  })
  async reparseUserTelemetryWithProgress(userId: string): Promise<{ success: boolean; message: string; totalMatches: number; processedMatches: number; successMatches: number; failedMatches: number; userId: string }> {
    const matchIds = await this.getUserMatchHistory(userId);
    const totalMatches = matchIds.length;
    let processedMatches = 0;
    let successMatches = 0;
    let failedMatches = 0;

    for (const matchId of matchIds) {
      getCurrentTaskContext()?.checkCancelled();

      try {
        const result = await this.reparseMatchTelemetry(matchId);
        if (result.success) {
          successMatches++;
        } else {
          failedMatches++;
        }
      } catch (error) {
        this.logger.warn(`Failed to reparse match ${matchId}: ${error.message}`);
        failedMatches++;
      }

      processedMatches++;
      await getCurrentTaskContext()?.updateProgress(Math.round((processedMatches / totalMatches) * 100));
    }

    return { success: true, message: `User telemetry reparse completed: ${successMatches}/${totalMatches} matches`, totalMatches, processedMatches, successMatches, failedMatches, userId };
  }

  /**
   * 重解析所有用户比赛遥测数据（带进度回调）
   * 使用批量 API 一次性获取所有用户的比赛，避免逐个查询
   */
  @ExecutableTask({
    type: 'reparse_all',
    async: true,
    buildResult: (result) => ({
      success: true,
      message: (result as { message?: string })?.message || 'All telemetry reparse completed',
      ...(result as Record<string, unknown>),
    }),
  })
  async reparseAllTelemetryWithProgress(): Promise<{ success: boolean; message: string; totalMatches: number; processedMatches: number; successMatches: number; failedMatches: number }> {
    const deathNoteUsers = await this.prisma.deathNoteGeneration.findMany({
      where: { isGenerated: true },
      select: { userId: true },
    });

    const userIds = deathNoteUsers.map(u => u.userId);
    const playersMatches = await this.getPlayersMatchesBatch(userIds);

    const allMatchIds = new Set<string>();
    for (const [, matchIds] of playersMatches) {
      matchIds.forEach(id => allMatchIds.add(id));
    }

    const matchIds = Array.from(allMatchIds);
    const totalMatches = matchIds.length;
    let processedMatches = 0;
    let successMatches = 0;
    let failedMatches = 0;

    for (const matchId of matchIds) {
      getCurrentTaskContext()?.checkCancelled();

      try {
        const result = await this.reparseMatchTelemetry(matchId);
        if (result.success) {
          successMatches++;
        } else {
          failedMatches++;
        }
      } catch (error) {
        this.logger.warn(`Failed to reparse match ${matchId}: ${error.message}`);
        failedMatches++;
      }

      processedMatches++;
      await getCurrentTaskContext()?.updateProgress(Math.round((processedMatches / totalMatches) * 100));
    }

    return { success: true, message: `All telemetry reparse completed: ${successMatches}/${totalMatches} matches`, totalMatches, processedMatches, successMatches, failedMatches };
  }
}
