// src/pubg/pubg-death-note-progress.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService } from '../task/task.service';
import { FailedMatch, DeathNoteProgressData } from './pubg-death-note.types';

@Injectable()
export class DeathNoteProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
  ) {}

  // ============================================================
  // 公开 API - 进度查询
  // ============================================================

  /**
   * 获取用户死亡笔记生成进度
   * 
   * 功能说明：
   * - 查询用户的进度记录
   * - 自动解析 JSON 字段为对象
   * 
   * @param userId - 用户 ID
   * @returns 进度数据，不存在时返回 null
   */
  async getProgress(userId: string): Promise<DeathNoteProgressData | null> {
    const progress = await this.prisma.deathNoteProgress.findUnique({
      where: { userId },
    });

    if (!progress) {
      return null;
    }

    return {
      userId: progress.userId,
      taskId: progress.taskId,
      totalMatches: progress.totalMatches,
      processedCount: progress.processedCount,
      processedMatches: JSON.parse(progress.processedMatches) as string[],
      failedMatches: JSON.parse(progress.failedMatches) as FailedMatch[],
      updatedAt: progress.updatedAt,
    };
  }

  // ============================================================
  // 公开 API - 进度管理
  // ============================================================

  /**
   * 保存用户死亡笔记生成进度
   * 
   * 功能说明：
   * - 使用 upsert 保证记录唯一性
   * - 自动计算进度百分比
   * - 同步更新任务进度和心跳
   * - 并行执行数据库操作提高性能
   * 
   * @param userId - 用户 ID
   * @param taskId - 任务 ID
   * @param processedIds - 已处理的比赛 ID 集合
   * @param processedCount - 已处理数量
   * @param failedMatches - 失败的比赛列表
   * @param totalMatches - 总比赛数量
   */
  async saveProgress(
    userId: string,
    taskId: string | undefined,
    processedIds: Set<string>,
    processedCount: number,
    failedMatches: FailedMatch[],
    totalMatches: number,
  ): Promise<void> {
    if (!taskId) return;

    const progress = Math.round((processedCount / totalMatches) * 100);

    await Promise.all([
      this.prisma.deathNoteProgress.upsert({
        where: { userId },
        create: {
          userId,
          taskId,
          totalMatches,
          processedCount,
          processedMatches: JSON.stringify([...processedIds]),
          failedMatches: JSON.stringify(failedMatches),
        },
        update: {
          taskId,
          totalMatches,
          processedCount,
          processedMatches: JSON.stringify([...processedIds]),
          failedMatches: JSON.stringify(failedMatches),
          updatedAt: new Date(),
        },
      }),
      this.taskService.updateProgress(taskId, progress),
      this.taskService.updateHeartbeat(taskId),
    ]);
  }

  /**
   * 清理用户进度记录
   * 
   * 功能说明：
   * - 删除用户的进度数据
   * - 在生成完成后调用
   * 
   * @param userId - 用户 ID
   */
  async cleanupProgress(userId: string): Promise<void> {
    await this.prisma.deathNoteProgress.deleteMany({
      where: { userId },
    });
  }
}
