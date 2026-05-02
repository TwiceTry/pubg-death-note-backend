import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService, TaskResult } from '../task/task.service';
import { PubgDeathNoteService } from '../pubg/pubg-death-note.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';

@Injectable()
export class ScheduledTaskService implements OnModuleInit {
  private cronJobs: Map<string, CronJob> = new Map();

  constructor(
    private prisma: PrismaService,
    private taskService: TaskService,
    private pubgDeathNoteService: PubgDeathNoteService,
    private logger: DualOutputLoggerService,
  ) {}

  async onModuleInit() {
    await this.initializeScheduledTasks();
  }

  private async initializeScheduledTasks() {
    let config = await this.prisma.scheduledTaskConfig.findUnique({
      where: { type: 'daily_incremental' },
    });

    if (!config) {
      config = await this.prisma.scheduledTaskConfig.create({
        data: {
          id: 'daily_incremental',
          type: 'daily_incremental',
          cron: '0 2 * * *',
          enabled: true,
        },
      });
    }

    if (config.enabled) {
      this.scheduleDailyIncremental(config.cron);
    }

    this.logger.log('Scheduled tasks initialized completed');
  }

  private scheduleDailyIncremental(cron: string) {
    const job = new CronJob(cron, async () => {
      await this.executeDailyIncremental();
    }, null, false, 'Asia/Shanghai');

    job.start();
    this.cronJobs.set('daily_incremental', job);

    this.logger.log(`Daily incremental task scheduled with cron: ${cron}`);
  }

  async executeDailyIncremental() {
    this.logger.log('Starting daily incremental task...');

    try {
      const users = await this.prisma.deathNoteGeneration.findMany({
        where: {
          isGenerated: true,
        },
        select: { userId: true },
      });

      this.logger.log(`Found ${users.length} users for daily incremental`);

      let successCount = 0;
      let skipCount = 0;
      let failCount = 0;

      for (const { userId } of users) {
        try {
          const hasRunning = await this.taskService.hasRunningTask(userId);
          if (hasRunning) {
            this.logger.log(`User ${userId} has running task, skipping`);
            skipCount++;
            continue;
          }

          await this.taskService.createAndExecuteTask(
            'death_note_daily_incremental',
            async (taskId: string): Promise<TaskResult> => {
              const result = await this.pubgDeathNoteService.incrementalUpdate(userId, taskId);
              return {
                success: true,
                message: 'Daily incremental update completed',
                ...result,
              };
            },
            userId,
          );

          successCount++;
        } catch (error) {
          this.logger.error(`Daily incremental failed for user ${userId}:`, error);
          failCount++;
        }
      }

      await this.prisma.scheduledTaskConfig.update({
        where: { type: 'daily_incremental' },
        data: {
          lastRun: new Date(),
        },
      });

      this.logger.log(`Daily incremental completed: ${successCount} success, ${skipCount} skipped, ${failCount} failed`);
    } catch (error) {
      this.logger.error('Daily incremental task failed:', error);
    }
  }
}
