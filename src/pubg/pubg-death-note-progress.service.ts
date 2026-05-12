import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService } from '../task/task.service';

export interface FailedMatch {
  matchId: string;
  error: string;
  retryCount: number;
}

export interface DeathNoteProgressData {
  userId: string;
  taskId: string;
  totalMatches: number;
  processedCount: number;
  processedMatches: string[];
  failedMatches: FailedMatch[];
  updatedAt: Date;
}

@Injectable()
export class DeathNoteProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
  ) {}

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

  async cleanupProgress(userId: string): Promise<void> {
    await this.prisma.deathNoteProgress.deleteMany({
      where: { userId },
    });
  }
}
