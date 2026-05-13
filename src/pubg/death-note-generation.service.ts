// src/pubg/death-note-generation.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgUserService } from './pubg-user.service';
import { DeathNoteStatusResult, DeathNoteOverview } from './pubg-death-note.types';

@Injectable()
export class DeathNoteGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: PubgUserService,
  ) {}

  // ============================================================
  // 公开 API - 数据查询
  // ============================================================

  /**
   * 根据用户 ID 查询死亡笔记生成记录
   * 
   * @param userId - 用户 ID
   * @returns 死亡笔记生成记录，不存在时返回 null
   */
  async findByUserId(userId: string) {
    return this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });
  }

  /**
   * 查询所有死亡笔记生成记录
   * 
   * @returns 死亡笔记生成记录列表，按更新时间倒序
   */
  async findAll() {
    return this.prisma.deathNoteGeneration.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * 检查用户是否存在死亡笔记生成记录
   * 
   * @param userId - 用户 ID
   * @returns 是否存在记录
   */
  async exists(userId: string): Promise<boolean> {
    const generation = await this.findByUserId(userId);
    return !!generation;
  }

  /**
   * 检查用户死亡笔记是否已生成
   * 
   * @param userId - 用户 ID
   * @returns 是否已生成
   */
  async isGenerated(userId: string): Promise<boolean> {
    const generation = await this.findByUserId(userId);
    return generation?.isGenerated ?? false;
  }

  // ============================================================
  // 公开 API - 数据管理
  // ============================================================

  /**
   * 创建死亡笔记生成记录
   * 
   * 功能说明：
   * - 创建用户的死亡笔记生成记录
   * - 默认 isGenerated 为 false
   * - 默认开启每日增量更新
   * 
   * @param userId - 用户 ID
   * @param data - 可选的初始配置
   * @returns 创建的记录
   */
  async create(userId: string, data: { isGenerated?: boolean; dailyIncrementalEnabled?: boolean }) {
    return this.prisma.deathNoteGeneration.create({
      data: {
        userId,
        isGenerated: data.isGenerated ?? false,
        dailyIncrementalEnabled: data.dailyIncrementalEnabled ?? true,
      },
    });
  }

  /**
   * 更新生成状态
   * 
   * @param userId - 用户 ID
   * @param isGenerated - 是否已生成
   * @returns 更新后的记录
   */
  async updateIsGenerated(userId: string, isGenerated: boolean) {
    return this.prisma.deathNoteGeneration.update({
      where: { userId },
      data: { isGenerated },
    });
  }

  /**
   * 重置生成状态
   * 
   * 功能说明：
   * - 将 isGenerated 设置为 false
   * - 用于触发重新生成
   * 
   * @param userId - 用户 ID
   * @returns 更新后的记录
   */
  async reset(userId: string) {
    return this.prisma.deathNoteGeneration.update({
      where: { userId },
      data: { isGenerated: false },
    });
  }

  /**
   * 删除用户的死亡笔记生成记录
   * 
   * @param userId - 用户 ID
   * @returns 删除结果
   */
  async deleteByUserId(userId: string) {
    return this.prisma.deathNoteGeneration.deleteMany({
      where: { userId },
    });
  }

  // ============================================================
  // 公开 API - 状态查询
  // ============================================================

  /**
   * 获取死亡笔记生成状态
   * 
   * 功能说明：
   * - 查询用户的生成记录
   * - 获取最新的相关任务状态和进度
   * 
   * @param userId - 用户 ID
   * @returns 生成状态结果
   */
  async getGenerationStatus(userId: string): Promise<DeathNoteStatusResult> {
    const generation = await this.findByUserId(userId);

    if (!generation) {
      throw new Error(`No death note generation record found for user ${userId}`);
    }

    const latestTask = await this.prisma.task.findFirst({
      where: { userId, type: { contains: 'death_note' } },
      orderBy: { createdAt: 'desc' },
      select: { status: true, progress: true, type: true },
    });

    return {
      isGenerated: generation.isGenerated,
      createdAt: generation.createdAt,
      latestTaskStatus: latestTask?.status ?? null,
      latestTaskProgress: latestTask?.progress ?? 0,
      latestTaskType: latestTask?.type ?? null,
    };
  }

  /**
   * 获取所有死亡笔记概览
   * 
   * 功能说明：
   * - 获取所有用户的死亡笔记概览信息
   * - 并行查询用户信息、首次任务时间、最新任务状态
   * - 包含生成状态、任务进度、更新时间等
   * 
   * @returns 死亡笔记概览列表
   */
  async getAllOverviews(): Promise<DeathNoteOverview[]> {
    const generations = await this.findAll();
    const results: DeathNoteOverview[] = [];

    for (const gen of generations) {
      const [user, firstTask, latestTask] = await Promise.all([
        this.userService.getUserById(gen.userId),
        this.prisma.task.findFirst({
          where: { userId: gen.userId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.task.findFirst({
          where: { userId: gen.userId },
          orderBy: { createdAt: 'desc' },
          select: { status: true, progress: true, type: true, completedAt: true },
        }),
      ]);

      results.push({
        userId: gen.userId,
        nickname: user.name,
        isGenerated: gen.isGenerated,
        createdAt: gen.createdAt,
        dailyIncrementalEnabled: gen.dailyIncrementalEnabled,
        latestTaskStatus: latestTask?.status ?? null,
        latestTaskProgress: latestTask?.progress ?? 0,
        latestTaskType: latestTask?.type ?? null,
        firstRequestTime: firstTask?.createdAt ?? gen.createdAt,
        lastUpdateTime: latestTask?.completedAt ?? null,
      });
    }

    return results;
  }
}
