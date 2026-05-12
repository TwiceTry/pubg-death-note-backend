// src/death-note/death-note.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgUserService } from '../pubg/pubg-user.service';
import { PubgDeathNoteService } from '../pubg/pubg-death-note.service';
import { KillEventService } from '../pubg/kill-event.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import { cache } from '../common/cache.utils';
import { UserMatchService } from '../pubg/user-match.service';
import {
  UserInfo,
  VictimKillHistoryResponse,
  DeathNotePaginatedResponse,
  MatchGroup,
  DayMatchGroup,
  SniperQueryResponse,
  SniperPlayer,
} from './death-note.types';

@Injectable()
export class DeathNoteService {
  private readonly USER_UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
  private readonly CACHE_TTL = DEATH_NOTE.CACHE_TTL_SECONDS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubgUserService: PubgUserService,
    private readonly pubgDeathNoteService: PubgDeathNoteService,
    private readonly killEventService: KillEventService,
    private readonly userMatchService: UserMatchService,
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

    const [killEvents, deathEvents] = await Promise.all([
      this.killEventService.findByKillerOrName(
        cachedKiller?.pubgId ?? null,
        cachedKiller ? null : nickname,
        cachedVictim?.pubgId ?? null,
        cachedVictim ? null : victimNickname,
      ),
      this.killEventService.findByKillerOrName(
        cachedVictim?.pubgId ?? null,
        cachedVictim ? null : victimNickname,
        cachedKiller?.pubgId ?? null,
        cachedKiller ? null : nickname,
      ),
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

    const [deathEvents, killEvents] = await Promise.all([
      this.killEventService.findByKillerOrName(
        cachedKiller?.pubgId ?? null,
        cachedKiller ? null : killerNickname,
        cachedVictim?.pubgId ?? null,
        cachedVictim ? null : nickname,
      ),
      this.killEventService.findByKillerOrName(
        cachedVictim?.pubgId ?? null,
        cachedVictim ? null : nickname,
        cachedKiller?.pubgId ?? null,
        cachedKiller ? null : killerNickname,
      ),
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

    const userMatches = await this.userMatchService.findMatchesByUserIdAndMatchIds(userId, matchIds);

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
          victimId: event.victimId,
          killerName: event.killerName,
          killerId: event.killerId,
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
          victimId: event.victimId,
          killerName: event.killerName,
          killerId: event.killerId,
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

    const killEvents = await this.killEventService.findByUserIdAndDateRange(userId, startDateTime, endDateTime);

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
  async getAvailableDates(nickname: string): Promise<{ dates: string[]; winDates: string[] }> {
    const cacheKey = `deathnote:${nickname}:dates`;
    const cached = await cache.get<{ dates: string[]; winDates: string[] }>(cacheKey);
    if (cached) {
      return cached;
    }

    const cachedUser = await this.prisma.user.findFirst({
      where: { nickname },
    });

    if (!cachedUser) {
      return { dates: [], winDates: [] };
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
      select: { playedAt: true, id: true },
      orderBy: { playedAt: 'desc' },
      distinct: ['playedAt'],
    });

    const allDates = [...new Set(
      matchDates
        .filter(m => m.playedAt)
        .map(m => new Date(m.playedAt!).toISOString().split('T')[0])
    )].sort((a, b) => b.localeCompare(a));

    const matchIds = matchDates.map(m => m.id);
    const userMatches = await this.userMatchService.findMatchesByUserIdAndMatchIds(userId, matchIds);
    const winMatchIds = userMatches.filter(um => um.won).map(um => um.matchId);

    const winDates = [...new Set(
      matchDates
        .filter(m => winMatchIds.includes(m.id) && m.playedAt)
        .map(m => new Date(m.playedAt!).toISOString().split('T')[0])
    )].sort((a, b) => b.localeCompare(a));

    const result = { dates: allDates, winDates };
    await cache.set(cacheKey, result, this.CACHE_TTL);

    return result;
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

    const killEvents = await this.killEventService.findByUserIdAndDateRange(userId, startDateTime, endDateTime);

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

  /**
   * 狙击查询：统计与指定目标玩家的相互击杀互动次数
   * 返回击杀当前玩家2次以上的玩家榜单，按击杀次数排名，只返回前5名
   */
  async getSniperList(nickname: string, targetNickname?: string): Promise<SniperQueryResponse> {
    const cacheKey = `deathnote:${nickname}:snipers:${targetNickname || 'all'}`;
    const cached = await cache.get<SniperQueryResponse>(cacheKey);
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
        totalSnipers: 0,
        snipers: [],
      };
    }

    const userId = cachedUser.pubgId;

    // 如果指定了目标玩家，只查询与该玩家的互动
    let killedByEvents: Array<{ killerId: string | null; killerName: string | null }>;
    let myKillEvents: Array<{ victimId: string; victimName: string | null }>;

    if (targetNickname) {
      const targetUser = await this.prisma.user.findFirst({
        where: { nickname: targetNickname },
      });

      if (!targetUser) {
        return {
          userId,
          nickname: cachedUser.nickname,
          totalSnipers: 0,
          snipers: [],
        };
      }

      const targetUserId = targetUser.pubgId;

      killedByEvents = await this.killEventService.findKilledByUser(userId, targetUserId);

      myKillEvents = await this.killEventService.findKillsByUser(userId, targetUserId);
    } else {
      killedByEvents = await this.killEventService.findKilledByUser(userId);

      myKillEvents = await this.killEventService.findKillsByUser(userId);
    }

    const killsByThemMap = new Map<string, { name: string; count: number }>();
    killedByEvents.forEach(event => {
      if (event.killerId) {
        const existing = killsByThemMap.get(event.killerId);
        if (existing) {
          existing.count++;
        } else {
          killsByThemMap.set(event.killerId, { name: event.killerName || 'Unknown', count: 1 });
        }
      }
    });

    const killsByMeMap = new Map<string, { name: string; count: number }>();
    myKillEvents.forEach(event => {
      const existing = killsByMeMap.get(event.victimId);
      if (existing) {
        existing.count++;
      } else {
        killsByMeMap.set(event.victimId, { name: event.victimName || 'Unknown', count: 1 });
      }
    });

    const snipers: SniperPlayer[] = [];
    killsByThemMap.forEach((data, killerId) => {
      if (data.count >= 2) {
        const killsByMe = killsByMeMap.get(killerId)?.count || 0;
        snipers.push({
          killerName: data.name,
          killerId,
          killsByThem: data.count,
          killsByMe,
          totalInteractions: data.count + killsByMe,
        });
      }
    });

    snipers.sort((a, b) => b.totalInteractions - a.totalInteractions);

    const result: SniperQueryResponse = {
      userId,
      nickname: cachedUser.nickname,
      totalSnipers: snipers.length,
      snipers,
    };

    await cache.set(cacheKey, result, this.CACHE_TTL);

    return result;
  }

}
