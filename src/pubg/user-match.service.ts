import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UserMatchInfo {
  matchId: string;
  ranking: number | null;
  won: boolean;
}

@Injectable()
export class UserMatchService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findAllByUserId(userId: string): Promise<UserMatchInfo[]> {
    const userMatches = await this.prisma.userMatch.findMany({
      where: { userId },
      select: { matchId: true, ranking: true, won: true },
    });
    return userMatches;
  }

  async findMatchIdsByUserId(userId: string): Promise<string[]> {
    const userMatches = await this.findAllByUserId(userId);
    return userMatches.map(m => m.matchId);
  }

  async findMatchesByUserIdAndMatchIds(userId: string, matchIds: string[]): Promise<UserMatchInfo[]> {
    return this.prisma.userMatch.findMany({
      where: {
        userId,
        matchId: { in: matchIds },
      },
      select: { matchId: true, ranking: true, won: true },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.userMatch.deleteMany({ where: { userId } });
  }

  async upsert(userId: string, matchId: string, ranking: number, won: boolean): Promise<void> {
    await this.prisma.userMatch.upsert({
      where: { userId_matchId: { userId, matchId } },
      update: { ranking, won },
      create: { userId, matchId, ranking, won },
    });
  }

  async createManyWithInfo(userId: string, matches: UserMatchInfo[]): Promise<void> {
    const data = matches.map(m => ({ userId, matchId: m.matchId, ranking: m.ranking, won: m.won }));
    await this.prisma.userMatch.createMany({ data });
  }
}
