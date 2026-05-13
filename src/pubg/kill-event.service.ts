// src/pubg/kill-event.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeathNoteDataResult, KillHistoryResult, SniperStatsResult, DeathNoteDataGroupedResult, MatchGroup } from './pubg-death-note.types';
import { UserMatchService } from './user-match.service';

export interface DayMatchGroup {
  date: string;
  matches: MatchGroup[];
  kills: number;
  deaths: number;
}

@Injectable()
export class KillEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userMatchService: UserMatchService,
  ) {}

  // ============================================================
  // 公开 API - 击杀事件查询（基础）
  // ============================================================

  /**
   * 查询用户所有击杀事件（带比赛信息）
   * 
   * 功能说明：
   * - 查询用户作为击杀者或被击杀者的所有事件
   * - 包含关联的比赛信息（时间、地图、模式）
   * - 按时间倒序排列
   * 
   * @param userId - 用户 ID
   * @returns 击杀事件列表
   */
  async findByUserId(userId: string) {
    return this.prisma.killEvent.findMany({
      where: {
        OR: [{ killerId: userId }, { victimId: userId }],
      },
      orderBy: { timestamp: 'desc' },
      include: {
        match: {
          select: { playedAt: true, mapName: true, gameMode: true },
        },
      },
    });
  }

  /**
   * 按用户 ID 和日期范围查询击杀事件
   * 
   * 功能说明：
   * - 查询指定日期范围内的击杀事件
   * - 包含关联的比赛信息
   * - 按时间倒序排列
   * 
   * @param userId - 用户 ID
   * @param startDate - 开始日期
   * @param endDate - 结束日期
   * @returns 击杀事件列表
   */
  async findByUserIdAndDateRange(userId: string, startDate: Date, endDate: Date) {
    return this.prisma.killEvent.findMany({
      where: {
        OR: [{ killerId: userId }, { victimId: userId }],
        match: {
          playedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        match: {
          select: { playedAt: true, mapName: true, gameMode: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * 查询特定击杀者对特定受害者的击杀记录
   * 
   * 功能说明：
   * - 查询两个玩家之间的单向击杀记录
   * - 包含关联的比赛信息
   * - 按时间倒序排列
   * 
   * @param killerId - 击杀者 ID
   * @param victimId - 受害者 ID
   * @returns 击杀事件列表
   */
  async findByKillerAndVictim(killerId: string, victimId: string) {
    return this.prisma.killEvent.findMany({
      where: {
        killerId,
        victimId,
      },
      include: {
        match: {
          select: { playedAt: true, mapName: true, gameMode: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * 按击杀者/受害者 ID 或昵称查询击杀记录（支持混合查询）
   * 
   * 功能说明：
   * - 支持 ID 和昵称混合查询
   * - 优先使用 ID，ID 为空时使用昵称
   * - 包含关联的比赛信息
   * 
   * @param killerId - 击杀者 ID（可选）
   * @param killerName - 击杀者昵称（可选）
   * @param victimId - 受害者 ID（可选）
   * @param victimName - 受害者昵称（可选）
   * @returns 击杀事件列表
   */
  async findByKillerOrName(
    killerId: string | null,
    killerName: string | null,
    victimId: string | null,
    victimName: string | null,
  ) {
    const where: any = {};

    if (killerId) {
      where.killerId = killerId;
    } else if (killerName) {
      where.killerName = killerName;
    }

    if (victimId) {
      where.victimId = victimId;
    } else if (victimName) {
      where.victimName = victimName;
    }

    return this.prisma.killEvent.findMany({
      where,
      include: {
        match: {
          select: { playedAt: true, mapName: true, gameMode: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * 查询指定日期的击杀事件
   * 
   * 功能说明：
   * - 查询用户在某一天（00:00:00 - 23:59:59）的击杀事件
   * 
   * @param userId - 用户 ID
   * @param date - 日期字符串（YYYY-MM-DD）
   * @returns 击杀事件列表
   */
  async getKillEventsByDate(userId: string, date: string) {
    const startDateTime = new Date(date + 'T00:00:00.000Z');
    const endDateTime = new Date(date + 'T23:59:59.999Z');

    return this.findByUserIdAndDateRange(userId, startDateTime, endDateTime);
  }

  // ============================================================
  // 公开 API - 击杀事件查询（筛选）
  // ============================================================

  /**
   * 查询用户被击杀记录（排除 TDM 模式）
   * 
   * 功能说明：
   * - 查询用户作为受害者的记录
   * - 排除 TDM（团队死斗）模式
   * - 可选择指定击杀者
   * 
   * @param userId - 用户 ID
   * @param targetKillerId - 指定击杀者 ID（可选）
   * @returns 被击杀记录列表（包含击杀者信息）
   */
  async findKilledByUser(userId: string, targetKillerId?: string) {
    const where: any = {
      victimId: userId,
      killerId: { not: null },
      match: {
        gameMode: {
          not: { contains: 'tdm' },
        },
      },
    };

    if (targetKillerId) {
      where.killerId = targetKillerId;
    }

    return this.prisma.killEvent.findMany({
      where,
      select: {
        killerId: true,
        killerName: true,
      },
    });
  }

  /**
   * 查询用户击杀记录（排除 TDM 模式）
   * 
   * 功能说明：
   * - 查询用户作为击杀者的记录
   * - 排除 TDM（团队死斗）模式
   * - 可选择指定受害者
   * 
   * @param userId - 用户 ID
   * @param targetVictimId - 指定受害者 ID（可选）
   * @returns 击杀记录列表（包含受害者信息）
   */
  async findKillsByUser(userId: string, targetVictimId?: string) {
    const where: any = {
      killerId: userId,
      match: {
        gameMode: {
          not: { contains: 'tdm' },
        },
      },
    };

    if (targetVictimId) {
      where.victimId = targetVictimId;
    }

    return this.prisma.killEvent.findMany({
      where,
      select: {
        victimId: true,
        victimName: true,
      },
    });
  }

  // ============================================================
  // 公开 API - 击杀统计
  // ============================================================

  /**
   * 统计用户击杀数
   * 
   * 功能说明：
   * - 统计用户作为击杀者的事件数量
   * - 可选择日期范围
   * 
   * @param userId - 用户 ID
   * @param startDate - 开始日期（可选）
   * @param endDate - 结束日期（可选）
   * @returns 击杀数量
   */
  async countKillsByUserId(userId: string, startDate?: Date, endDate?: Date): Promise<number> {
    const where: any = { killerId: userId };

    if (startDate && endDate) {
      where.match = {
        playedAt: {
          gte: startDate,
          lte: endDate,
        },
      };
    }

    return this.prisma.killEvent.count({ where });
  }

  /**
   * 统计用户死亡数
   * 
   * 功能说明：
   * - 统计用户作为受害者的事件数量
   * - 可选择日期范围
   * 
   * @param userId - 用户 ID
   * @param startDate - 开始日期（可选）
   * @param endDate - 结束日期（可选）
   * @returns 死亡数量
   */
  async countDeathsByUserId(userId: string, startDate?: Date, endDate?: Date): Promise<number> {
    const where: any = { victimId: userId };

    if (startDate && endDate) {
      where.match = {
        playedAt: {
          gte: startDate,
          lte: endDate,
        },
      };
    }

    return this.prisma.killEvent.count({ where });
  }

  // ============================================================
  // 公开 API - 日期查询
  // ============================================================

  /**
   * 获取用户所有有击杀/死亡数据的比赛日期
   * 
   * 功能说明：
   * - 查询用户参与过的所有有击杀事件的日期
   * - 按日期去重并降序排列
   * 
   * @param userId - 用户 ID
   * @returns 比赛日期列表（YYYY-MM-DD 格式，降序）
   */
  async getMatchDates(userId: string): Promise<string[]> {
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

    return [...new Set(
      matchDates
        .filter(m => m.playedAt)
        .map(m => new Date(m.playedAt!).toISOString().split('T')[0])
    )].sort((a, b) => b.localeCompare(a));
  }

  // ============================================================
  // 公开 API - 事件分组
  // ============================================================

  /**
   * 将击杀事件按比赛分组
   * 
   * 功能说明：
   * - 将击杀事件列表按比赛 ID 分组
   * - 包含每场比赛的击杀/死亡统计
   * - 包含比赛排名和是否吃鸡信息
   * 
   * @param killEvents - 击杀事件列表
   * @param userId - 用户 ID
   * @returns 按比赛分组的 Map
   */
  async groupEventsByMatch(
    killEvents: Array<{
      matchId: string;
      killerId: string | null;
      killerName: string | null;
      victimId: string;
      victimName: string;
      weaponId: string;
      distance: number;
      isHeadshot: boolean;
      timestamp: Date;
      match?: {
        playedAt: Date;
        mapName: string | null;
        gameMode: string | null;
      } | null;
    }>,
    userId: string,
  ): Promise<Map<string, MatchGroup>> {
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
          matchTime: event.match?.playedAt ?? null,
          mapName: event.match?.mapName ?? null,
          gameMode: event.match?.gameMode ?? null,
          ranking: rankingMap.get(matchId) ?? null,
          won: wonMap.get(matchId) ?? false,
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
          matchTime: event.match?.playedAt ?? null,
          mapName: event.match?.mapName ?? null,
          gameMode: event.match?.gameMode ?? null,
          weaponId: event.weaponId,
          victimName: event.victimName,
          victimId: event.victimId,
          killerName: event.killerName ?? 'Unknown',
          killerId: event.killerId,
          distance: event.distance,
          isHeadshot: event.isHeadshot,
          timestamp: event.timestamp,
        });
      } else if (event.victimId === userId) {
        matchGroup.deaths++;
        matchGroup.deathDetails.push({
          matchId,
          matchTime: event.match?.playedAt ?? null,
          mapName: event.match?.mapName ?? null,
          gameMode: event.match?.gameMode ?? null,
          weaponId: event.weaponId,
          victimName: event.victimName,
          victimId: event.victimId,
          killerName: event.killerName ?? 'Unknown',
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
   * 
   * 功能说明：
   * - 将比赛列表按日期分组
   * - 统计每天的击杀/死亡总数
   * - 按日期降序排列
   * 
   * @param matches - 比赛列表
   * @returns 按天分组的列表
   */
  groupMatchesByDay(matches: MatchGroup[]): DayMatchGroup[] {
    const dayMap = new Map<string, DayMatchGroup>();

    matches.forEach(match => {
      const matchDate = match.matchTime
        ? new Date(match.matchTime).toISOString().split('T')[0]
        : 'unknown';

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
   * 
   * 功能说明：
   * - 从按天分组的列表中提取最早和最晚日期
   * 
   * @param allDays - 所有天的列表
   * @returns 起止日期
   */
  calculateDateRange(allDays: DayMatchGroup[]): { startDate: string | null; endDate: string | null } {
    if (allDays.length === 0) {
      return { startDate: null, endDate: null };
    }

    const endDate = allDays[0].date === 'unknown' ? null : allDays[0].date;
    const startDate = allDays[allDays.length - 1].date === 'unknown' ? null : allDays[allDays.length - 1].date;

    return { startDate, endDate };
  }

  // ============================================================
  // 公开 API - 业务查询（死亡笔记）
  // ============================================================

  /**
   * 获取死亡笔记数据
   * 
   * 功能说明：
   * - 获取用户完整的死亡笔记数据
   * - 包含击杀/死亡统计和详细事件列表
   * - 包含生成时间戳
   * 
   * @param userId - 用户 ID
   * @param generationCreatedAt - 生成时间
   * @returns 死亡笔记数据结果
   */
  async getDeathNoteData(userId: string, generationCreatedAt: Date): Promise<DeathNoteDataResult> {
    const user = await this.prisma.user.findFirst({
      where: { pubgId: userId },
    });

    if (!user) {
      throw new Error(`User not found for ID ${userId}`);
    }

    const killEvents = await this.findByUserId(userId);

    const totalKills = killEvents.filter(e => e.killerId === userId).length;
    const totalDeaths = killEvents.filter(e => e.victimId === userId).length;

    return {
      userId,
      nickname: user.nickname,
      totalKills,
      totalDeaths,
      killEvents,
      lastUpdated: generationCreatedAt,
    };
  }

  /**
   * 获取按比赛分组的死亡笔记数据
   * 
   * 功能说明：
   * - 获取用户完整的死亡笔记数据
   * - 按比赛分组，包含每场比赛的击杀/死亡统计
   * - 包含详细的击杀和死亡事件列表
   * - 一次查询完成分组，避免二次处理
   * - 包含比赛排名和是否吃鸡信息
   * 
   * @param userId - 用户 ID
   * @param generationCreatedAt - 生成时间
   * @returns 按比赛分组的死亡笔记数据结果
   */
  async getDeathNoteDataGroupedByMatch(userId: string, generationCreatedAt: Date): Promise<DeathNoteDataGroupedResult> {
    const user = await this.prisma.user.findFirst({
      where: { pubgId: userId },
    });

    if (!user) {
      throw new Error(`User not found for ID ${userId}`);
    }

    const killEvents = await this.findByUserId(userId);

    const matchIds = [...new Set(killEvents.map(e => e.matchId))];
    const userMatches = await this.userMatchService.findMatchesByUserIdAndMatchIds(userId, matchIds);

    const rankingMap = new Map<string, number | null>();
    const wonMap = new Map<string, boolean>();
    userMatches.forEach(um => {
      rankingMap.set(um.matchId, um.ranking);
      wonMap.set(um.matchId, um.won);
    });

    const matchMap = await this.groupEventsByMatch(killEvents, userId);

    const totalKills = killEvents.filter(e => e.killerId === userId).length;
    const totalDeaths = killEvents.filter(e => e.victimId === userId).length;

    const matches = Array.from(matchMap.values()).map(group => ({
      matchId: group.matchId,
      matchTime: group.matchTime,
      mapName: group.mapName,
      gameMode: group.gameMode,
      ranking: group.ranking,
      won: group.won,
      kills: group.kills,
      deaths: group.deaths,
      killDetails: group.killDetails,
      deathDetails: group.deathDetails,
    }));

    return {
      userId,
      nickname: user.nickname,
      totalKills,
      totalDeaths,
      matches,
      lastUpdated: generationCreatedAt,
    };
  }

  /**
   * 查询两个玩家间的击杀历史
   * 
   * 功能说明：
   * - 并行查询两个方向的击杀记录
   * - 返回详细的击杀信息（武器、距离、爆头等）
   * - 包含双方击杀/死亡统计
   * 
   * @param killerId - 击杀者 ID
   * @param killerNickname - 击杀者昵称
   * @param victimId - 受害者 ID
   * @param victimNickname - 受害者昵称
   * @returns 击杀历史结果
   */
  async getKillHistoryBetweenPlayers(
    killerId: string,
    killerNickname: string,
    victimId: string,
    victimNickname: string,
  ): Promise<KillHistoryResult> {
    const [killEvents, deathEvents] = await Promise.all([
      this.findByKillerAndVictim(killerId, victimId),
      this.findByKillerAndVictim(victimId, killerId),
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
      killerId,
      killerNickname,
      victimId,
      victimNickname,
      totalKills: killEvents.length,
      totalDeaths: deathEvents.length,
      killDetails,
    };
  }

  /**
   * 获取狙击统计（击杀当前玩家 2 次以上的玩家榜单）
   * 
   * 功能说明：
   * - 统计击杀当前玩家次数超过 2 次的玩家
   * - 同时统计当前玩家对他们的反杀次数
   * - 按击杀次数降序排列，返回全部结果
   * 
   * @param userId - 用户 ID
   * @param targetUserId - 指定目标玩家 ID（可选）
   * @returns 狙击统计结果
   */
  async getSniperStats(userId: string, targetUserId?: string): Promise<SniperStatsResult> {
    const killedByEvents = await this.findKilledByUser(userId, targetUserId);
    const myKillEvents = await this.findKillsByUser(userId, targetUserId);

    const killsByThemMap = new Map<string, { name: string; count: number }>();
    killedByEvents.forEach(event => {
      if (event.killerId) {
        const existing = killsByThemMap.get(event.killerId);
        if (existing) {
          existing.count++;
        } else {
          killsByThemMap.set(event.killerId, { name: event.killerName ?? 'Unknown', count: 1 });
        }
      }
    });

    const killsByMeMap = new Map<string, number>();
    myKillEvents.forEach(event => {
      if (event.victimId) {
        const count = killsByMeMap.get(event.victimId) ?? 0;
        killsByMeMap.set(event.victimId, count + 1);
      }
    });

    const snipers = Array.from(killsByThemMap.entries())
      .filter(([, data]) => data.count > 2)
      .map(([killerId, data]) => ({
        killerId,
        killerName: data.name,
        killsByThem: data.count,
        killsByMe: killsByMeMap.get(killerId) ?? 0,
        totalInteractions: data.count + (killsByMeMap.get(killerId) ?? 0),
      }))
      .sort((a, b) => b.killsByThem - a.killsByThem);

    return {
      totalSnipers: snipers.length,
      snipers,
    };
  }
}
