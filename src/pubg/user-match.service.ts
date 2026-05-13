// src/pubg/user-match.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserMatchInfo } from './pubg-death-note.types';

@Injectable()
export class UserMatchService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ============================================================
  // 公开 API - 比赛查询
  // ============================================================

  /**
   * 查询用户所有比赛记录
   * 
   * 功能说明：
   * - 获取用户参与的所有比赛
   * - 包含排名和是否吃鸡信息
   * 
   * @param userId - 用户 ID
   * @returns 用户比赛信息列表
   */
  async findAllByUserId(userId: string): Promise<UserMatchInfo[]> {
    const userMatches = await this.prisma.userMatch.findMany({
      where: { userId },
      select: { matchId: true, ranking: true, won: true },
    });
    return userMatches;
  }

  /**
   * 查询用户所有比赛 ID 列表
   * 
   * 功能说明：
   * - 仅返回比赛 ID，不包含其他信息
   * - 适用于只需要 ID 列表的场景
   * 
   * @param userId - 用户 ID
   * @returns 比赛 ID 列表
   */
  async findMatchIdsByUserId(userId: string): Promise<string[]> {
    const userMatches = await this.findAllByUserId(userId);
    return userMatches.map(m => m.matchId);
  }

  /**
   * 根据比赛 ID 列表查询用户比赛记录
   * 
   * 功能说明：
   * - 批量查询指定比赛的用户记录
   * - 包含排名和是否吃鸡信息
   * 
   * @param userId - 用户 ID
   * @param matchIds - 比赛 ID 列表
   * @returns 匹配的比赛信息列表
   */
  async findMatchesByUserIdAndMatchIds(userId: string, matchIds: string[]): Promise<UserMatchInfo[]> {
    return this.prisma.userMatch.findMany({
      where: {
        userId,
        matchId: { in: matchIds },
      },
      select: { matchId: true, ranking: true, won: true },
    });
  }

  /**
   * 获取用户吃鸡的比赛日期
   * 
   * 功能说明：
   * - 根据比赛 ID 列表查询用户吃鸡的比赛
   * - 返回吃鸡日期列表（去重、降序）
   * 
   * @param userId - 用户 ID
   * @param matchIds - 比赛 ID 列表
   * @returns 吃鸡日期列表（YYYY-MM-DD 格式，降序）
   */
  async getWinDates(userId: string, matchIds: string[]): Promise<string[]> {
    const userMatches = await this.findMatchesByUserIdAndMatchIds(userId, matchIds);
    const winMatchIds = userMatches.filter(um => um.won).map(um => um.matchId);

    const matchDates = await this.prisma.match.findMany({
      where: {
        id: { in: matchIds },
      },
      select: { id: true, playedAt: true },
    });

    return [...new Set(
      matchDates
        .filter(m => winMatchIds.includes(m.id) && m.playedAt)
        .map(m => new Date(m.playedAt!).toISOString().split('T')[0])
    )].sort((a, b) => b.localeCompare(a));
  }

  // ============================================================
  // 公开 API - 比赛管理
  // ============================================================

  /**
   * 创建或更新用户比赛记录
   * 
   * 功能说明：
   * - 使用 upsert 保证记录唯一性
   * - 记录存在时更新排名和吃鸡状态
   * - 记录不存在时创建新记录
   * 
   * @param userId - 用户 ID
   * @param matchId - 比赛 ID
   * @param ranking - 排名
   * @param won - 是否吃鸡
   */
  async upsert(userId: string, matchId: string, ranking: number, won: boolean): Promise<void> {
    await this.prisma.userMatch.upsert({
      where: { userId_matchId: { userId, matchId } },
      update: { ranking, won },
      create: { userId, matchId, ranking, won },
    });
  }

  /**
   * 批量创建用户比赛记录
   * 
   * 功能说明：
   * - 使用 createMany 提高批量插入性能
   * - 适用于初始化或恢复数据场景
   * 
   * @param userId - 用户 ID
   * @param matches - 比赛信息列表
   */
  async createManyWithInfo(userId: string, matches: UserMatchInfo[]): Promise<void> {
    const data = matches.map(m => ({ userId, matchId: m.matchId, ranking: m.ranking, won: m.won }));
    await this.prisma.userMatch.createMany({ data });
  }

  /**
   * 删除用户所有比赛记录
   * 
   * @param userId - 用户 ID
   */
  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.userMatch.deleteMany({ where: { userId } });
  }
}
