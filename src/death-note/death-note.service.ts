// src/death-note/death-note.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgUserService } from '../pubg/pubg-user.service';
import { PubgDeathNoteService } from '../pubg/pubg-death-note.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import { cache } from '../common/cache.utils';
import {
  UserInfo,
  VictimKillHistoryResponse,
  DeathNotePaginatedResponse,
  MatchGroup,
  DayMatchGroup,
} from './death-note.types';

@Injectable()
export class DeathNoteService {
  private readonly USER_UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
  private readonly CACHE_TTL = DEATH_NOTE.CACHE_TTL_SECONDS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubgUserService: PubgUserService,
    private readonly pubgDeathNoteService: PubgDeathNoteService,
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
   * 查询当前用户是否击杀过指定昵称的玩家，返回击杀详情
   * 仅查询本地 killEvent 表，不调用 PUBG API，避免限速率问题
   */
  async getVictimKillHistory(nickname: string, victimNickname: string): Promise<VictimKillHistoryResponse> {
    const cachedKiller = await this.prisma.user.findFirst({
      where: { nickname },
    });

    const cachedVictim = await this.prisma.user.findFirst({
      where: { nickname: victimNickname },
    });

    // 查询 nickname 击杀 victimNickname 的记录
    const killerWhereClause: any = {};
    if (cachedKiller) {
      killerWhereClause.killerId = cachedKiller.pubgId;
    } else {
      killerWhereClause.killerName = nickname;
    }
    if (cachedVictim) {
      killerWhereClause.victimId = cachedVictim.pubgId;
    } else {
      killerWhereClause.victimName = victimNickname;
    }

    // 查询 victimNickname 击杀 nickname 的记录（反向）
    const victimWhereClause: any = {};
    if (cachedVictim) {
      victimWhereClause.killerId = cachedVictim.pubgId;
    } else {
      victimWhereClause.killerName = victimNickname;
    }
    if (cachedKiller) {
      victimWhereClause.victimId = cachedKiller.pubgId;
    } else {
      victimWhereClause.victimName = nickname;
    }

    const [killEvents, deathEvents] = await Promise.all([
      this.prisma.killEvent.findMany({
        where: killerWhereClause,
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
      this.prisma.killEvent.findMany({
        where: victimWhereClause,
      }),
    ]);

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
      totalDeaths: deathEvents.length,
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

    const cachedKiller = await this.prisma.user.findFirst({
      where: { nickname: killerNickname },
    });

    // 查询 killerNickname 击杀 nickname 的记录
    const victimWhereClause: any = {};
    if (cachedVictim) {
      victimWhereClause.victimId = cachedVictim.pubgId;
    } else {
      victimWhereClause.victimName = nickname;
    }
    if (cachedKiller) {
      victimWhereClause.killerId = cachedKiller.pubgId;
    } else {
      victimWhereClause.killerName = killerNickname;
    }

    // 查询 nickname 击杀 killerNickname 的记录（反向）
    const killerWhereClause: any = {};
    if (cachedVictim) {
      killerWhereClause.killerId = cachedVictim.pubgId;
    } else {
      killerWhereClause.killerName = nickname;
    }
    if (cachedKiller) {
      killerWhereClause.victimId = cachedKiller.pubgId;
    } else {
      killerWhereClause.victimName = killerNickname;
    }

    const [deathEvents, killEvents] = await Promise.all([
      this.prisma.killEvent.findMany({
        where: victimWhereClause,
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
      this.prisma.killEvent.findMany({
        where: killerWhereClause,
      }),
    ]);

    const killDetails = deathEvents.map(event => ({
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
      totalKills: killEvents.length,
      totalDeaths: deathEvents.length,
      killDetails,
    };
  }

  /**
   * 将击杀事件按比赛分组
   */
  private async groupEventsByMatch(killEvents: any[], userId: string): Promise<Map<string, MatchGroup>> {
    const matchMap = new Map<string, MatchGroup>();
    const matchIds = [...new Set(killEvents.map(e => e.matchId))];

    const userMatches = await this.prisma.userMatch.findMany({
      where: {
        userId,
        matchId: { in: matchIds },
      },
      select: { matchId: true, ranking: true, won: true },
    });

    const rankingMap = new Map<string, number | null>();
    const wonMap = new Map<string, boolean>();
    userMatches.forEach(um => {
      rankingMap.set(um.matchId, um.ranking);
      wonMap.set(um.matchId, um.won);
    });

    killEvents.forEach(event => {
      const matchId = event.matchId;

      if (!matchMap.has(matchId)) {
        matchMap.set(matchId, {
          matchId,
          matchTime: event.match?.playedAt || null,
          mapName: event.match?.mapName || null,
          gameMode: event.match?.gameMode || null,
          ranking: rankingMap.get(matchId) || null,
          won: wonMap.get(matchId) || false,
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
   * 数据库层面分页：先获取日期列表分页，再只查询对应日期的数据
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

    // 阶段1：获取所有有数据的日期（轻量级聚合查询）
    const matchDates = await this.prisma.match.findMany({
      where: {
        killEvents: {
          some: {
            OR: [
              { killerId: userId },
              { victimId: userId },
            ],
          },
        },
      },
      select: { playedAt: true },
      orderBy: { playedAt: 'desc' },
      distinct: ['playedAt'],
    });

    // 按日期去重并排序
    const allDates = [...new Set(
      matchDates
        .filter(m => m.playedAt)
        .map(m => new Date(m.playedAt!).toISOString().split('T')[0])
    )].sort((a, b) => b.localeCompare(a));

    const totalDays = allDates.length;
    const totalPages = Math.ceil(totalDays / pageSize);
    const validPage = Math.max(1, Math.min(page, totalPages || 1));

    // 阶段2：获取当前页对应的日期范围
    const startIndex = (validPage - 1) * pageSize;
    const paginatedDates = allDates.slice(startIndex, startIndex + pageSize);

    if (paginatedDates.length === 0) {
      return {
        userId,
        nickname: cachedUser.nickname,
        totalMatches: 0,
        totalKills: 0,
        totalDeaths: 0,
        totalDays: 0,
        startDate: null,
        endDate: null,
        page: validPage,
        pageSize,
        totalPages,
        days: [],
      };
    }

    // 阶段3：只查询分页日期范围内的击杀事件
    const startDate = paginatedDates[paginatedDates.length - 1];
    const endDate = paginatedDates[0];
    const startDateTime = new Date(startDate + 'T00:00:00.000Z');
    const endDateTime = new Date(endDate + 'T23:59:59.999Z');

    const killEvents = await this.prisma.killEvent.findMany({
      where: {
        OR: [
          { killerId: userId },
          { victimId: userId },
        ],
        match: {
          playedAt: {
            gte: startDateTime,
            lte: endDateTime,
          },
        },
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
    });

    const totalKills = killEvents.filter(e => e.killerId === userId).length;
    const totalDeaths = killEvents.filter(e => e.victimId === userId).length;

    const matchMap = await this.groupEventsByMatch(killEvents, userId);

    const pageMatches = Array.from(matchMap.values())
      .filter(match => match.kills > 0 || match.deaths > 0)
      .sort((a, b) => {
        const timeA = a.matchTime?.getTime() || 0;
        const timeB = b.matchTime?.getTime() || 0;
        return timeB - timeA;
      });

    const pageDays = this.groupMatchesByDay(pageMatches);

    // 阶段4：获取全局统计信息（仅首次请求或缓存过期时）
    const { startDate: globalStartDate, endDate: globalEndDate } = this.calculateDateRange(
      allDates.map(date => ({ date, matches: [], kills: 0, deaths: 0 })),
    );

    const result: DeathNotePaginatedResponse = {
      userId,
      nickname: cachedUser.nickname,
      totalMatches: pageMatches.length,
      totalKills,
      totalDeaths,
      totalDays,
      startDate: globalStartDate,
      endDate: globalEndDate,
      page: validPage,
      pageSize,
      totalPages,
      days: pageDays,
    };

    await cache.set(cacheKey, result, this.CACHE_TTL);

    return result;
  }

  /**
   * 获取有数据的日期列表（轻量级，用于日历绿点显示）
   */
  async getAvailableDates(nickname: string): Promise<string[]> {
    const cacheKey = `deathnote:${nickname}:dates`;
    const cached = await cache.get<string[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const cachedUser = await this.prisma.user.findFirst({
      where: { nickname },
    });

    if (!cachedUser) {
      return [];
    }

    const userId = cachedUser.pubgId;

    const matchDates = await this.prisma.match.findMany({
      where: {
        killEvents: {
          some: {
            OR: [
              { killerId: userId },
              { victimId: userId },
            ],
          },
        },
      },
      select: { playedAt: true },
      orderBy: { playedAt: 'desc' },
      distinct: ['playedAt'],
    });

    const allDates = [...new Set(
      matchDates
        .filter(m => m.playedAt)
        .map(m => new Date(m.playedAt!).toISOString().split('T')[0])
    )].sort((a, b) => b.localeCompare(a));

    await cache.set(cacheKey, allDates, this.CACHE_TTL);

    return allDates;
  }

  /**
   * 按日期查询死亡笔记数据
   * 数据库层面过滤：只查询指定日期的数据
   */
  async getDeathNoteByDate(
    nickname: string,
    date: string,
  ): Promise<DeathNotePaginatedResponse> {
    const cacheKey = `deathnote:${nickname}:date:${date}`;
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
        page: 1,
        pageSize: 1,
        totalPages: 0,
        days: [],
      };
    }

    const userId = cachedUser.pubgId;

    // 阶段1：只查询指定日期的击杀事件
    const startDateTime = new Date(date + 'T00:00:00.000Z');
    const endDateTime = new Date(date + 'T23:59:59.999Z');

    const killEvents = await this.prisma.killEvent.findMany({
      where: {
        OR: [
          { killerId: userId },
          { victimId: userId },
        ],
        match: {
          playedAt: {
            gte: startDateTime,
            lte: endDateTime,
          },
        },
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
    });

    const totalKills = killEvents.filter(e => e.killerId === userId).length;
    const totalDeaths = killEvents.filter(e => e.victimId === userId).length;

    const matchMap = await this.groupEventsByMatch(killEvents, userId);

    const dayMatches = Array.from(matchMap.values())
      .filter(match => match.kills > 0 || match.deaths > 0)
      .sort((a, b) => {
        const timeA = a.matchTime?.getTime() || 0;
        const timeB = b.matchTime?.getTime() || 0;
        return timeB - timeA;
      });

    const dayData = dayMatches.length > 0
      ? { date, matches: dayMatches, kills: totalKills, deaths: totalDeaths }
      : null;

    // 阶段2：获取全局日期范围（轻量级查询）
    const matchDates = await this.prisma.match.findMany({
      where: {
        killEvents: {
          some: {
            OR: [
              { killerId: userId },
              { victimId: userId },
            ],
          },
        },
      },
      select: { playedAt: true },
      orderBy: { playedAt: 'desc' },
      distinct: ['playedAt'],
    });

    const allDates = [...new Set(
      matchDates
        .filter(m => m.playedAt)
        .map(m => new Date(m.playedAt!).toISOString().split('T')[0])
    )].sort((a, b) => b.localeCompare(a));

    const { startDate, endDate } = this.calculateDateRange(
      allDates.map(d => ({ date: d, matches: [], kills: 0, deaths: 0 })),
    );

    const result: DeathNotePaginatedResponse = {
      userId,
      nickname: cachedUser.nickname,
      totalMatches: dayMatches.length,
      totalKills,
      totalDeaths,
      totalDays: allDates.length,
      startDate,
      endDate,
      page: 1,
      pageSize: allDates.length,
      totalPages: 1,
      days: dayData ? [dayData] : [],
    };

    await cache.set(cacheKey, result, this.CACHE_TTL);

    return result;
  }

}
