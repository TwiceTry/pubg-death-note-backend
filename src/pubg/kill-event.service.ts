import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DeathNoteDataResult {
  userId: string;
  nickname: string;
  totalKills: number;
  totalDeaths: number;
  killEvents: Array<{
    id: number;
    matchId: string;
    killerId: string | null;
    killerName: string | null;
    victimId: string;
    victimName: string;
    weaponId: string;
    distance: number;
    isHeadshot: boolean;
    timestamp: Date;
    match: {
      playedAt: Date;
      mapName: string | null;
      gameMode: string | null;
    };
  }>;
  lastUpdated: Date;
}

export interface KillHistoryResult {
  killerId: string;
  killerNickname: string;
  victimId: string;
  victimNickname: string;
  totalKills: number;
  totalDeaths: number;
  killDetails: Array<{
    matchId: string;
    matchTime: Date | null;
    mapName: string | null;
    gameMode: string | null;
    weaponId: string;
    distance: number;
    isHeadshot: boolean;
    timestamp: Date;
  }>;
}

export interface SniperStatsResult {
  totalSnipers: number;
  snipers: Array<{
    playerId: string;
    playerName: string;
    killsByThem: number;
    killsByMe: number;
  }>;
}

@Injectable()
export class KillEventService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 查询用户所有击杀事件（带比赛信息）
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
   * 按用户ID和日期范围查询击杀事件
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
   * 按击杀者/受害者ID或昵称查询击杀记录（支持混合查询）
   */
  async findByKillerOrName(killerId: string | null, killerName: string | null, victimId: string | null, victimName: string | null) {
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
   * 查询用户被击杀记录（排除TDM模式）
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
   * 查询用户击杀记录（排除TDM模式）
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

  /**
   * 统计用户击杀数
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

  /**
   * 获取死亡笔记数据
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
   * 查询两个玩家间的击杀历史
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
   * 查询指定日期的击杀事件
   */
  async getKillEventsByDate(userId: string, date: string) {
    const startDateTime = new Date(date + 'T00:00:00.000Z');
    const endDateTime = new Date(date + 'T23:59:59.999Z');

    return this.findByUserIdAndDateRange(userId, startDateTime, endDateTime);
  }

  /**
   * 获取狙击统计（击杀当前玩家2次以上的玩家榜单）
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
      .map(([playerId, data]) => ({
        playerId,
        playerName: data.name,
        killsByThem: data.count,
        killsByMe: killsByMeMap.get(playerId) ?? 0,
      }))
      .sort((a, b) => b.killsByThem - a.killsByThem)
      .slice(0, 5);

    return {
      totalSnipers: snipers.length,
      snipers,
    };
  }
}
