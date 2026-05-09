import { Injectable, OnModuleInit } from '@nestjs/common';
import { TaskService } from '../task/task.service';
import { PrismaService } from '../prisma/prisma.service';
import { PubgDeathNoteService } from '../pubg/pubg-death-note.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';

@Injectable()
export class AppBootstrapService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly pubgDeathNoteService: PubgDeathNoteService,
    private readonly logger: DualOutputLoggerService,
  ) {}

  async onModuleInit() {
    await this.cleanupStaleTasks();
    await this.resumeIncompleteTasks();
  }

  /**
   * 清理残留的运行中任务
   */
  private async cleanupStaleTasks(): Promise<void> {
    const cleanedCount = await this.taskService.cleanupStaleTasks();

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} stale running tasks`, 'Bootstrap');
    }
  }

  /**
   * 恢复未完成的死亡笔记生成任务
   */
  private async resumeIncompleteTasks(): Promise<void> {
    const incompleteGenerations = await this.prisma.deathNoteGeneration.findMany({
      where: { isGenerated: false },
    });

    if (incompleteGenerations.length === 0) {
      this.logger.log('No incomplete generations to resume', 'Bootstrap');
      return;
    }

    this.logger.log(`Found ${incompleteGenerations.length} incomplete generations, resuming...`, 'Bootstrap');

    for (const generation of incompleteGenerations) {
      try {
        await this.resumeSingleUser(generation.userId);
      } catch (error) {
        this.logger.error(`Failed to resume user ${generation.userId}:`, error, 'Bootstrap');
      }
    }
  }

  /**
   * 恢复单个用户的生成任务
   */
  private async resumeSingleUser(userId: string): Promise<void> {
    const progress = await this.prisma.deathNoteProgress.findUnique({
      where: { userId },
    });

    if (!progress) {
      this.logger.warn(`No progress record for user ${userId}, waiting for user to retry`, 'Bootstrap');
      return;
    }

    const processedCount = JSON.parse(progress.processedMatches).length;
    this.logger.log(`Resuming user ${userId}: ${processedCount} matches already processed`, 'Bootstrap');

    const hasRunning = await this.taskService.getRunningTask(userId);
    if (hasRunning) {
      this.logger.log(`User ${userId} already has running task, skipping`, 'Bootstrap');
      return;
    }

    await (this.pubgDeathNoteService as any).resumeGeneration(userId);
    this.logger.log(`Created resume task for user ${userId}`, 'Bootstrap');
  }
}
