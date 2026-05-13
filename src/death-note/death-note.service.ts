// src/death-note/death-note.service.ts
import { Injectable } from '@nestjs/common';
import { PubgUserService } from '../pubg/pubg-user.service';
import { KillEventService } from '../pubg/kill-event.service';
import { UserMatchService } from '../pubg/user-match.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import { cache } from '../common/cache.utils';
import {
  VictimKillHistoryResponse,
  DeathNotePaginatedResponse,
  SniperQueryResponse,
} from './death-note.types';

@Injectable()
export class DeathNoteService {
  private readonly CACHE_TTL = DEATH_NOTE.CACHE_TTL_SECONDS;

  constructor(
    private readonly pubgUserService: PubgUserService,
    private readonly killEventService: KillEventService,
    private readonly userMatchService: UserMatchService,
    private readonly logger: DualOutputLoggerService,
  ) {}

  // ============================================================
  // 公开 API - 击杀历史查询
  // ============================================================

  /**
   * 查询当前用户是否击杀过指定昵称的玩家，返回击杀详情
   * 
   * 功能说明：
   * - 查询两个玩家之间的击杀记录
   * - 同时查询反向死亡记录
   * - 仅查询本地数据库，不调用 PUBG API
   * 
   * @param nickname - 当前用户昵称
   * @param victimNickname - 目标玩家昵称
   * @returns 击杀历史记录，包含击杀详情和统计数据
   */
  async getVictimKillHistory(nickname: string, victimNickname: string): Promise<VictimKillHistoryResponse> {
    const [cachedKiller, cachedVictim] = await Promise.all([
      this.pubgUserService.findUserByNickname(nickname),
      this.pubgUserService.findUserByNickname(victimNickname),
    ]);

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
      matchTime: event.match?.playedAt ?? null,
      mapName: event.match?.mapName ?? null,
      gameMode: event.match?.gameMode ?? null,
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
   * 
   * 功能说明：
   * - 查询两个玩家之间的反向击杀记录
   * - 同时查询正向击杀记录
   * - 仅查询本地数据库，不调用 PUBG API
   * 
   * @param nickname - 当前用户昵称
   * @param killerNickname - 击杀者昵称
   * @returns 被击杀历史记录，包含死亡详情和统计数据
   */
  async getKilledByHistory(nickname: string, killerNickname: string): Promise<VictimKillHistoryResponse> {
    const [cachedVictim, cachedKiller] = await Promise.all([
      this.pubgUserService.findUserByNickname(nickname),
      this.pubgUserService.findUserByNickname(killerNickname),
    ]);

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
      matchTime: event.match?.playedAt ?? null,
      mapName: event.match?.mapName ?? null,
      gameMode: event.match?.gameMode ?? null,
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

  // ============================================================
  // 公开 API - 死亡笔记分页查询
  // ============================================================

  /**
   * 分页查询死亡笔记数据，按天分组
   * 
   * 功能说明：
   * - 数据库层面分页：先获取日期列表分页，再只查询对应日期的数据
   * - 按天分组展示比赛数据
   * - 包含缓存机制提高查询性能
   * 
   * @param nickname - 用户昵称
   * @param page - 页码（从 1 开始）
   * @param pageSize - 每页天数
   * @returns 分页的死亡笔记数据，包含比赛分组和统计信息
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

    const cachedUser = await this.pubgUserService.findUserByNickname(nickname);
    if (!cachedUser) {
      return this.createEmptyPaginatedResponse(nickname, page, pageSize);
    }

    const userId = cachedUser.pubgId;
    const allDates = await this.killEventService.getMatchDates(userId);

    const totalDays = allDates.length;
    const totalPages = Math.ceil(totalDays / pageSize);
    const validPage = Math.max(1, Math.min(page, totalPages || 1));

    const startIndex = (validPage - 1) * pageSize;
    const paginatedDates = allDates.slice(startIndex, startIndex + pageSize);

    if (paginatedDates.length === 0) {
      return this.createEmptyPaginatedResponse(cachedUser.nickname, validPage, pageSize, totalDays, totalPages);
    }

    const startDate = paginatedDates[paginatedDates.length - 1];
    const endDate = paginatedDates[0];
    const startDateTime = new Date(startDate + 'T00:00:00.000Z');
    const endDateTime = new Date(endDate + 'T23:59:59.999Z');

    const killEvents = await this.killEventService.findByUserIdAndDateRange(userId, startDateTime, endDateTime);
    const matchMap = await this.killEventService.groupEventsByMatch(killEvents, userId);

    const pageMatches = Array.from(matchMap.values())
      .filter(match => match.kills > 0 || match.deaths > 0)
      .sort((a, b) => {
        const timeA = a.matchTime?.getTime() || 0;
        const timeB = b.matchTime?.getTime() || 0;
        return timeB - timeA;
      });

    const pageDays = this.killEventService.groupMatchesByDay(pageMatches);
    const { startDate: globalStartDate, endDate: globalEndDate } = this.killEventService.calculateDateRange(
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
   * 获取有数据的日期列表（用于日历绿点显示）
   * 
   * 功能说明：
   * - 获取用户所有有击杀/死亡数据的日期
   * - 获取用户吃鸡的日期列表
   * - 包含缓存机制提高查询性能
   * 
   * @param nickname - 用户昵称
   * @returns 有数据的日期列表和吃鸡日期列表
   */
  async getAvailableDates(nickname: string): Promise<{ dates: string[]; winDates: string[] }> {
    const cacheKey = `deathnote:${nickname}:dates`;
    const cached = await cache.get<{ dates: string[]; winDates: string[] }>(cacheKey);
    if (cached) {
      return cached;
    }

    const cachedUser = await this.pubgUserService.findUserByNickname(nickname);
    if (!cachedUser) {
      return { dates: [], winDates: [] };
    }

    const userId = cachedUser.pubgId;
    const allDates = await this.killEventService.getMatchDates(userId);

    const matchIds = await this.getMatchIdsFromDates(userId, allDates);
    const winDates = await this.userMatchService.getWinDates(userId, matchIds);

    const result = { dates: allDates, winDates };
    await cache.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  /**
   * 按日期查询死亡笔记数据
   * 
   * 功能说明：
   * - 数据库层面过滤：只查询指定日期的数据
   * - 按天分组展示比赛数据
   * - 包含缓存机制提高查询性能
   * 
   * @param nickname - 用户昵称
   * @param date - 日期字符串（YYYY-MM-DD）
   * @returns 指定日期的死亡笔记数据，包含比赛分组和统计信息
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

    const cachedUser = await this.pubgUserService.findUserByNickname(nickname);
    if (!cachedUser) {
      return this.createEmptyPaginatedResponse(nickname, 1, 1);
    }

    const userId = cachedUser.pubgId;
    const startDateTime = new Date(date + 'T00:00:00.000Z');
    const endDateTime = new Date(date + 'T23:59:59.999Z');

    const killEvents = await this.killEventService.findByUserIdAndDateRange(userId, startDateTime, endDateTime);
    const matchMap = await this.killEventService.groupEventsByMatch(killEvents, userId);

    const dayMatches = Array.from(matchMap.values())
      .filter(match => match.kills > 0 || match.deaths > 0)
      .sort((a, b) => {
        const timeA = a.matchTime?.getTime() || 0;
        const timeB = b.matchTime?.getTime() || 0;
        return timeB - timeA;
      });

    const totalKills = dayMatches.reduce((sum, m) => sum + m.kills, 0);
    const totalDeaths = dayMatches.reduce((sum, m) => sum + m.deaths, 0);

    const dayData = dayMatches.length > 0
      ? { date, matches: dayMatches, kills: totalKills, deaths: totalDeaths }
      : null;

    const allDates = await this.killEventService.getMatchDates(userId);
    const { startDate, endDate } = this.killEventService.calculateDateRange(
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

  // ============================================================
  // 公开 API - 狙击查询
  // ============================================================

  /**
   * 狙击查询：统计与指定目标玩家的相互击杀互动次数
   * 
   * 功能说明：
   * - 统计击杀当前玩家 2 次以上的玩家
   * - 按击杀次数排名，返回前 5 名
   * - 支持指定目标玩家进行精确查询
   * - 包含缓存机制提高查询性能
   * 
   * @param nickname - 用户昵称
   * @param targetNickname - 目标玩家昵称（可选）
   * @returns 狙击手列表，包含相互击杀统计数据
   */
  async getSniperList(nickname: string, targetNickname?: string): Promise<SniperQueryResponse> {
    const cacheKey = `deathnote:${nickname}:snipers:${targetNickname || 'all'}`;
    const cached = await cache.get<SniperQueryResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const cachedUser = await this.pubgUserService.findUserByNickname(nickname);
    if (!cachedUser) {
      return { userId: '', nickname, totalSnipers: 0, snipers: [] };
    }

    const userId = cachedUser.pubgId;
    const result = await this.killEventService.getSniperStats(userId);

    const response: SniperQueryResponse = {
      userId,
      nickname: cachedUser.nickname,
      totalSnipers: result.totalSnipers,
      snipers: result.snipers.map(s => ({
        killerName: s.killerName,
        killerId: s.killerId,
        killsByThem: s.killsByThem,
        killsByMe: s.killsByMe,
        totalInteractions: s.totalInteractions,
      })),
    };

    await cache.set(cacheKey, response, this.CACHE_TTL);
    return response;
  }

  // ============================================================
  // 私有方法 - 辅助函数
  // ============================================================

  /**
   * 创建空的分页响应
   * 
   * 功能说明：
   * - 当用户不存在或无数据时返回空响应
   * - 保持响应格式一致性
   * 
   * @param nickname - 用户昵称
   * @param page - 页码
   * @param pageSize - 每页大小
   * @param totalDays - 总天数（默认 0）
   * @param totalPages - 总页数（默认 0）
   * @returns 空的分页响应对象
   */
  private createEmptyPaginatedResponse(
    nickname: string,
    page: number,
    pageSize: number,
    totalDays = 0,
    totalPages = 0,
  ): DeathNotePaginatedResponse {
    return {
      userId: '',
      nickname,
      totalDays,
      startDate: null,
      endDate: null,
      page,
      pageSize,
      totalPages,
      days: [],
    };
  }

  /**
   * 从日期列表获取比赛 ID 列表
   * 
   * 功能说明：
   * - 根据日期范围查询击杀事件
   * - 提取并去重比赛 ID
   * 
   * @param userId - 用户 ID
   * @param dates - 日期列表（YYYY-MM-DD 格式）
   * @returns 比赛 ID 列表（去重）
   */
  private async getMatchIdsFromDates(userId: string, dates: string[]): Promise<string[]> {
    if (dates.length === 0) return [];

    const startDate = new Date(dates[dates.length - 1] + 'T00:00:00.000Z');
    const endDate = new Date(dates[0] + 'T23:59:59.999Z');

    const matches = await this.killEventService.findByUserIdAndDateRange(userId, startDate, endDate);
    return [...new Set(matches.map(m => m.matchId))];
  }
}
