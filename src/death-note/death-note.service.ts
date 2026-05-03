// src/death-note/death-note.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgUserService } from '../pubg/pubg-user.service';
import { PubgDeathNoteService } from '../pubg/pubg-death-note.service';
import { PubgSeasonService } from '../pubg/pubg-season.service';
import { TaskService } from '../task/task.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import { cache } from '../common/cache.utils';
import {
  UserInfo,
  DeathNoteStatusResponse,
  DeathNoteGenerationRequestResponse,
  DeathNoteDataResponse,
  SeasonRefreshResponse,
  VictimKillHistoryResponse,
  DeathNotePaginatedResponse,
  MatchGroup,
  DayMatchGroup,
} from './death-note.types';

@Injectable()
export class DeathNoteService {
  private readonly USER_UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
  private readonly DEATH_NOTE_TASK_TYPES = ['death_note_generate', 'death_note_force_generate'];
  private readonly CACHE_TTL = DEATH_NOTE.CACHE_TTL_SECONDS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubgUserService: PubgUserService,
    private readonly pubgDeathNoteService: PubgDeathNoteService,
    private readonly pubgSeasonService: PubgSeasonService,
    private readonly taskService: TaskService,
    private readonly logger: DualOutputLoggerService,
  ) {}

  /**
   * 校验昵称是否存在，不存在则从 API 获取并缓存
   */
  private async resolveUserInfo(nickname: string): Promise<UserInfo> {
    try {
      const cachedUser = await this.prisma.user.findFirst({
        where: { nickname },
      });

      if (cachedUser) {
        return this.refreshUserIfNeeded(cachedUser);
      }

      return this.fetchAndCacheUser(nickname);
    } catch (error) {
      this.logger.error(`Error resolving user info for nickname "${nickname}":`, error);
      throw new Error(`Nickname "${nickname}" does not exist in PUBG`);
    }
  }

  /**
   * 检查用户信息是否需要更新，需要则刷新
   */
  private async refreshUserIfNeeded(cachedUser: any): Promise<UserInfo> {
    const needsUpdate = Date.now() - cachedUser.updatedAt.getTime() > this.USER_UPDATE_INTERVAL;
    
    if (!needsUpdate) {
      return { id: cachedUser.pubgId, name: cachedUser.nickname };
    }

    try {
      const latestUser = await this.pubgUserService.getUserByNickname(cachedUser.nickname);
      
      if (latestUser.id !== cachedUser.pubgId) {
        await this.createOrUpdateUser(latestUser);
        await this.prisma.user.delete({ where: { pubgId: cachedUser.pubgId } });
        return latestUser;
      }

      await this.prisma.user.update({
        where: { pubgId: cachedUser.pubgId },
        data: { nickname: latestUser.name },
      });

      return { id: latestUser.id, name: latestUser.name };
    } catch {
      return { id: cachedUser.pubgId, name: cachedUser.nickname };
    }
  }

  /**
   * 从 API 获取用户信息并缓存
   */
  private async fetchAndCacheUser(nickname: string): Promise<UserInfo> {
    const userInfo = await this.pubgUserService.getUserByNickname(nickname);
    await this.createOrUpdateUser(userInfo);
    return userInfo;
  }

  /**
   * 创建或更新用户信息
   */
  private async createOrUpdateUser(userInfo: UserInfo) {
    return this.prisma.user.upsert({
      where: { pubgId: userInfo.id },
      update: { nickname: userInfo.name },
      create: { pubgId: userInfo.id, nickname: userInfo.name },
    });
  }

  /**
   * 查询死亡笔记生成状态（优先查询 DeathNoteGeneration，Task 作为辅助）
   */
  async getDeathNoteGenerationStatus(nickname: string): Promise<DeathNoteStatusResponse> {
    try {
      const userInfo = await this.resolveUserInfo(nickname);
      
      const generation = await this.prisma.deathNoteGeneration.findUnique({
        where: { userId: userInfo.id },
      });
      
      const latestTask = await this.taskService.getLatestTaskByUserId(
        userInfo.id,
        this.DEATH_NOTE_TASK_TYPES,
      );
      
      if (!generation) {
        return {
          isGenerated: false,
          status: 'not_requested',
          message: 'Death note generation not requested yet',
          taskId: latestTask?.id || null,
          userId: userInfo.id,
          nickname: userInfo.name,
        };
      }
      
      if (generation.isGenerated) {
        return {
          isGenerated: true,
          status: 'completed',
          message: 'Death note generation completed',
          taskId: latestTask?.id || null,
          progress: 100,
          requestTime: generation.requestTime,
          actualEndTime: generation.actualEndTime,
          firstGenerationDuration: generation.firstGenerationDuration,
          userId: userInfo.id,
          nickname: userInfo.name,
        };
      }
      
      // 检查心跳超时
      const HEARTBEAT_TIMEOUT = DEATH_NOTE.HEARTBEAT_TIMEOUT_MS;
      if (latestTask?.status === 'running') {
        const lastHeartbeat = latestTask.heartbeat || latestTask.startedAt;
        if (lastHeartbeat && Date.now() - new Date(lastHeartbeat).getTime() > HEARTBEAT_TIMEOUT) {
          return {
            isGenerated: false,
            status: 'timeout',
            message: 'Task interrupted, please retry',
            taskId: latestTask.id || null,
            progress: latestTask.progress || 0,
            requestTime: generation.requestTime,
            userId: userInfo.id,
            nickname: userInfo.name,
          };
        }
      }
      
      return {
        isGenerated: false,
        status: latestTask?.status || 'generating',
        message: 'Death note generation in progress',
        taskId: latestTask?.id || null,
        progress: latestTask?.progress || 0,
        requestTime: generation.requestTime,
        startedAt: latestTask?.startedAt || null,
        estimatedEndTime: generation.estimatedEndTime,
        userId: userInfo.id,
        nickname: userInfo.name,
      };
    } catch (error) {
      this.logger.error(`Error getting death note generation status:`, error);
      return {
        isGenerated: false,
        status: 'error',
        error: error.message || 'Internal server error',
        taskId: null,
      };
    }
  }

  /**
   * 请求生成死亡笔记（增量或首次）
   */
  async requestDeathNoteGeneration(nickname: string): Promise<DeathNoteGenerationRequestResponse> {
    try {
      const userInfo = await this.resolveUserInfo(nickname);
      
      const existingGeneration = await this.prisma.deathNoteGeneration.findUnique({
        where: { userId: userInfo.id },
      });
      
      const isIncremental = existingGeneration?.isGenerated || false;
      
      const taskId = await this.taskService.createAndExecuteTask(
        'death_note_generate',
        async (taskId: string) => {
          const result = await this.pubgDeathNoteService.requestDeathNoteGenerationByUserId(userInfo.id, taskId);
          
          return {
            success: true,
            message: isIncremental ? 'Death note incremental update completed' : 'Death note generation completed',
            isIncremental,
            ...result,
            userId: userInfo.id,
            nickname: userInfo.name,
          };
        },
        userInfo.id,
      );
      
      return {
        taskId,
        userId: userInfo.id,
        nickname: userInfo.name,
        isIncremental,
        message: isIncremental ? 'Death note incremental update started' : 'Death note generation started',
      };
    } catch (error) {
      this.logger.error(`Error requesting death note generation for ${nickname}:`, error);
      throw error;
    }
  }

  /**
   * 强制重新生成死亡笔记（清除旧数据后完全重建）
   */
  async forceDeathNoteGeneration(nickname: string): Promise<DeathNoteGenerationRequestResponse> {
    try {
      const userInfo = await this.resolveUserInfo(nickname);
      
      const taskId = await this.taskService.createAndExecuteTask(
        'death_note_force_generate',
        async (taskId: string) => {
          const result = await this.pubgDeathNoteService.forceGenerateDeathNote(userInfo.id, taskId);
          
          return {
            success: true,
            message: 'Force death note generation completed',
            ...result,
            userId: userInfo.id,
            nickname: userInfo.name,
          };
        },
        userInfo.id,
      );
      
      return {
        taskId,
        userId: userInfo.id,
        nickname: userInfo.name,
        message: 'Force death note generation started',
      };
    } catch (error) {
      this.logger.error(`Error force generating death note for ${nickname}:`, error);
      throw error;
    }
  }

  /**
   * 获取死亡笔记数据（支持生成中状态）
   */
  async getDeathNoteByNickname(nickname: string): Promise<DeathNoteDataResponse> {
    try {
      const userInfo = await this.resolveUserInfo(nickname);
      
      const generation = await this.prisma.deathNoteGeneration.findUnique({
        where: { userId: userInfo.id },
      });
      
      if (!generation) {
        throw new Error(`Death note generation not requested for user ${userInfo.id}`);
      }
      
      if (!generation.isGenerated) {
        const latestTask = await this.taskService.getLatestTaskByUserId(
          userInfo.id,
          this.DEATH_NOTE_TASK_TYPES,
        );
        
        return {
          isGenerated: false,
          status: 'generating',
          message: 'Death note generation in progress, please try again later',
          progress: latestTask?.progress || 0,
          taskId: latestTask?.id || null,
          userId: userInfo.id,
          nickname: userInfo.name,
        };
      }
      
      const deathNoteData = await this.pubgDeathNoteService.getDeathNoteData(userInfo.id);
      
      const formattedKillEvents = deathNoteData.killEvents.map(event => ({
        matchTime: event.match?.playedAt,
        mapName: event.match?.mapName,
        gameMode: event.match?.gameMode,
        victimName: event.victimName,
      }));
      
      return {
        userId: deathNoteData.userId,
        nickname: deathNoteData.nickname,
        totalKills: deathNoteData.totalKills,
        totalDeaths: deathNoteData.totalDeaths,
        killEvents: formattedKillEvents,
        lastUpdated: deathNoteData.lastUpdated,
        isGenerated: true,
        status: 'completed',
        userInfo,
      };
    } catch (error) {
      this.logger.error(`Error getting death note by nickname:`, error);
      return {
        error: error.message || 'Internal server error',
      };
    }
  }

  /**
   * 手动刷新赛季信息
   */
  async refreshSeasons(): Promise<SeasonRefreshResponse> {
    try {
      this.logger.log('Manual season refresh requested');
      const seasons = await this.pubgSeasonService.getAllSeasons(true);
      
      return {
        success: true,
        message: 'Seasons refreshed successfully',
        seasons: seasons.map(s => ({
          id: s.id,
          isCurrent: s.isCurrent,
          startDate: s.startDate,
          endDate: s.endDate,
        })),
      };
    } catch (error) {
      this.logger.error(`Error refreshing seasons:`, error);
      return {
        success: false,
        error: error.message || 'Internal server error',
      };
    }
  }

  /**
   * 查询当前用户是否击杀过指定昵称的玩家，返回击杀详情
   * 仅查询本地 killEvent 表，不调用 PUBG API，避免限速率问题
   */
  async getVictimKillHistory(nickname: string, victimNickname: string): Promise<VictimKillHistoryResponse> {
    const cachedKiller = await this.prisma.user.findFirst({
      where: { nickname },
    });
    
    const whereClause: any = {};
    
    if (cachedKiller) {
      whereClause.killerId = cachedKiller.pubgId;
    } else {
      whereClause.killerName = nickname;
    }
    
    const cachedVictim = await this.prisma.user.findFirst({
      where: { nickname: victimNickname },
    });
    
    if (cachedVictim) {
      whereClause.victimId = cachedVictim.pubgId;
    } else {
      whereClause.victimName = victimNickname;
    }
    
    const killEvents = await this.prisma.killEvent.findMany({
      where: whereClause,
      include: {
        match: {
          select: {
            playedAt: true,
            mapName: true,
            gameMode: true,
          }
        }
      },
      orderBy: {
        timestamp: 'desc'
      }
    });
    
    const killDetails = killEvents.map(event => ({
      matchId: event.matchId,
      matchTime: event.match?.playedAt,
      mapName: event.match?.mapName,
      gameMode: event.match?.gameMode,
      weaponId: event.weaponId,
      distance: event.distance,
      isHeadshot: event.isHeadshot,
      timestamp: event.timestamp,
    }));
    
    return {
      userId: cachedKiller?.pubgId || 'unknown',
      nickname: cachedKiller?.nickname || nickname,
      victimId: cachedVictim?.pubgId || 'unknown',
      victimNickname: cachedVictim?.nickname || victimNickname,
      totalKills: killEvents.length,
      totalDeaths: 0,
      killDetails,
    };
  }

  /**
   * 查询指定昵称的玩家是否击杀过当前用户，返回死亡详情
   * 仅查询本地 killEvent 表，不调用 PUBG API，避免限速率问题
   */
  async getKilledByHistory(nickname: string, killerNickname: string): Promise<VictimKillHistoryResponse> {
    const cachedVictim = await this.prisma.user.findFirst({
      where: { nickname },
    });
    
    const whereClause: any = {};
    
    if (cachedVictim) {
      whereClause.victimId = cachedVictim.pubgId;
    } else {
      whereClause.victimName = nickname;
    }
    
    const cachedKiller = await this.prisma.user.findFirst({
      where: { nickname: killerNickname },
    });
    
    if (cachedKiller) {
      whereClause.killerId = cachedKiller.pubgId;
    } else {
      whereClause.killerName = killerNickname;
    }
    
    const killEvents = await this.prisma.killEvent.findMany({
      where: whereClause,
      include: {
        match: {
          select: {
            playedAt: true,
            mapName: true,
            gameMode: true,
          }
        }
      },
      orderBy: {
        timestamp: 'desc'
      }
    });
    
    const killDetails = killEvents.map(event => ({
      matchId: event.matchId,
      matchTime: event.match?.playedAt,
      mapName: event.match?.mapName,
      gameMode: event.match?.gameMode,
      weaponId: event.weaponId,
      distance: event.distance,
      isHeadshot: event.isHeadshot,
      timestamp: event.timestamp,
    }));
    
    return {
      userId: cachedVictim?.pubgId || 'unknown',
      nickname: cachedVictim?.nickname || nickname,
      victimId: cachedKiller?.pubgId || 'unknown',
      victimNickname: cachedKiller?.nickname || killerNickname,
      totalKills: 0,
      totalDeaths: killEvents.length,
      killDetails,
    };
  }

  /**
   * 将击杀事件按比赛分组
   */
  private groupEventsByMatch(killEvents: any[], userId: string): Map<string, MatchGroup> {
    const matchMap = new Map<string, MatchGroup>();

    killEvents.forEach(event => {
      const matchId = event.matchId;

      if (!matchMap.has(matchId)) {
        matchMap.set(matchId, {
          matchId,
          matchTime: event.match?.playedAt || null,
          mapName: event.match?.mapName || null,
          gameMode: event.match?.gameMode || null,
          kills: 0,
          deaths: 0,
          killDetails: [],
          deathDetails: [],
        });
      }

      const matchGroup = matchMap.get(matchId)!;

      if (event.killerId === userId) {
        matchGroup.kills++;
        matchGroup.killDetails.push({
          matchId,
          matchTime: event.match?.playedAt || null,
          mapName: event.match?.mapName || null,
          gameMode: event.match?.gameMode || null,
          weaponId: event.weaponId,
          victimName: event.victimName,
          killerName: event.killerName,
          distance: event.distance,
          isHeadshot: event.isHeadshot,
          timestamp: event.timestamp,
        });
      } else if (event.victimId === userId) {
        matchGroup.deaths++;
        matchGroup.deathDetails.push({
          matchId,
          matchTime: event.match?.playedAt || null,
          mapName: event.match?.mapName || null,
          gameMode: event.match?.gameMode || null,
          weaponId: event.weaponId,
          victimName: event.victimName,
          killerName: event.killerName,
          distance: event.distance,
          isHeadshot: event.isHeadshot,
          timestamp: event.timestamp,
        });
      }
    });

    return matchMap;
  }

  /**
   * 将比赛按天分组
   */
  private groupMatchesByDay(matches: MatchGroup[]): DayMatchGroup[] {
    const dayMap = new Map<string, DayMatchGroup>();

    matches.forEach(match => {
      const matchDate = match.matchTime ? new Date(match.matchTime).toISOString().split('T')[0] : 'unknown';

      if (!dayMap.has(matchDate)) {
        dayMap.set(matchDate, {
          date: matchDate,
          matches: [],
          kills: 0,
          deaths: 0,
        });
      }

      const dayGroup = dayMap.get(matchDate)!;
      dayGroup.matches.push(match);
      dayGroup.kills += match.kills;
      dayGroup.deaths += match.deaths;
    });

    return Array.from(dayMap.values()).sort((a, b) => {
      if (a.date === 'unknown') return 1;
      if (b.date === 'unknown') return -1;
      return b.date.localeCompare(a.date);
    });
  }

  /**
   * 计算数据起止日期
   */
  private calculateDateRange(allDays: DayMatchGroup[]): { startDate: string | null; endDate: string | null } {
    if (allDays.length === 0) {
      return { startDate: null, endDate: null };
    }

    const endDate = allDays[0].date === 'unknown' ? null : allDays[0].date;
    const startDate = allDays[allDays.length - 1].date === 'unknown' ? null : allDays[allDays.length - 1].date;

    return { startDate, endDate };
  }

  /**
   * 分页查询死亡笔记数据，按天分组
   */
  async getDeathNotePaginated(
    nickname: string,
    page: number = 1,
    pageSize: number = 10,
  ): Promise<DeathNotePaginatedResponse> {
    const cacheKey = `deathnote:${nickname}:${page}:${pageSize}`;
    const cached = await cache.get<DeathNotePaginatedResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const cachedUser = await this.prisma.user.findFirst({
      where: { nickname },
    });

    if (!cachedUser) {
      return {
        userId: '',
        nickname,
        totalMatches: 0,
        totalKills: 0,
        totalDeaths: 0,
        totalDays: 0,
        startDate: null,
        endDate: null,
        page,
        pageSize,
        totalPages: 0,
        days: [],
      };
    }

    const userId = cachedUser.pubgId;

    const [killEvents, totalStats] = await Promise.all([
      this.prisma.killEvent.findMany({
        where: {
          OR: [
            { killerId: userId },
            { victimId: userId },
          ],
        },
        include: {
          match: {
            select: {
              playedAt: true,
              mapName: true,
              gameMode: true,
            },
          },
        },
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.killEvent.groupBy({
        by: ['killerId', 'victimId'],
        where: {
          OR: [
            { killerId: userId },
            { victimId: userId },
          ],
        },
        _count: true,
      }),
    ]);

    const totalKills = totalStats.filter(s => s.killerId === userId).reduce((sum, s) => sum + s._count, 0);
    const totalDeaths = totalStats.filter(s => s.victimId === userId).reduce((sum, s) => sum + s._count, 0);

    const matchMap = this.groupEventsByMatch(killEvents, userId);

    const allMatches = Array.from(matchMap.values())
      .filter(match => match.kills > 0)
      .sort((a, b) => {
        const timeA = a.matchTime?.getTime() || 0;
        const timeB = b.matchTime?.getTime() || 0;
        return timeB - timeA;
      });

    const allDays = this.groupMatchesByDay(allMatches);

    const totalMatches = allMatches.length;
    const totalDays = allDays.length;
    const totalPages = Math.ceil(totalDays / pageSize);
    const validPage = Math.max(1, Math.min(page, totalPages || 1));
    const startIndex = (validPage - 1) * pageSize;
    const paginatedDays = allDays.slice(startIndex, startIndex + pageSize);

    const { startDate, endDate } = this.calculateDateRange(allDays);

    const result: DeathNotePaginatedResponse = {
      userId,
      nickname: cachedUser.nickname,
      totalMatches,
      totalKills,
      totalDeaths,
      totalDays,
      startDate,
      endDate,
      page: validPage,
      pageSize,
      totalPages,
      days: paginatedDays,
    };

    await cache.set(cacheKey, result, this.CACHE_TTL);

    return result;
  }

  /**
   * 清除用户死亡笔记缓存
   */
  async invalidateCache(nickname: string): Promise<void> {
    await cache.invalidatePattern(`deathnote:${nickname}`);
  }
}
