// src/pubg/pubg-death-note.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgUserService } from './pubg-user.service';
import { PubgMatchService } from './pubg-match.service';
import { TaskService } from '../task/task.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import {
  DeathNoteGenerationResult,
  DeathNoteStatusResult,
  DeathNoteDataResult,
  FailedMatch,
} from './pubg-death-note.types';

@Injectable()
export class PubgDeathNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: PubgUserService,
    private readonly matchService: PubgMatchService,
    private readonly taskService: TaskService,
    private readonly logger: DualOutputLoggerService,
  ) {}

  /**
   * 请求生成死亡笔记（通过昵称）
   */
  async requestDeathNoteGeneration(nickname: string): Promise<DeathNoteGenerationResult> {
    try {
      const user = await this.userService.getUserByNickname(nickname);
      return this.requestDeathNoteGenerationByUserId(user.id);
    } catch (error) {
      this.logger.error(`Error requesting death note generation:`, error);
      throw error;
    }
  }

  /**
   * 请求生成死亡笔记（通过用户 ID）
   */
  async requestDeathNoteGenerationByUserId(userId: string, taskId?: string): Promise<DeathNoteGenerationResult> {
    try {
      let generation = await this.prisma.deathNoteGeneration.findUnique({
        where: { userId },
      });

      if (generation?.isGenerated) {
        this.logger.log(`User ${userId} already has generated death note, performing incremental update...`);
        
        const matchIds = await this.matchService.getUserMatchHistory(userId);
        const existingMatches = await this.prisma.userMatch.findMany({
          where: { userId },
          select: { matchId: true },
        });
        const existingMatchIds = new Set(existingMatches.map(m => m.matchId));
        const newMatchesCount = matchIds.filter(id => !existingMatchIds.has(id)).length;
        
        const estimatedEndTime = this.calculateEstimatedEndTime(newMatchesCount, generation.firstGenerationDuration);
        
        try {
          await this.prisma.deathNoteGeneration.update({
            where: { userId },
            data: { estimatedEndTime },
          });
        } catch (error) {
          this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted, creating new one...`);
          await this.prisma.deathNoteGeneration.create({
            data: {
              userId,
              requestTime: new Date(),
              isGenerated: false,
            },
          });
          await this.processMatches(userId, false, taskId);
          return {
            userId,
            isGenerated: false,
            estimatedEndTime: null,
          };
        }
        
        await this.processMatches(userId, true, taskId);
        
        const updatedGeneration = await this.prisma.deathNoteGeneration.findUnique({
          where: { userId },
        });
        
        return {
          userId,
          isGenerated: updatedGeneration?.isGenerated || false,
          estimatedEndTime: null,
        };
      }

      if (!generation) {
        generation = await this.prisma.deathNoteGeneration.create({
          data: {
            userId,
            requestTime: new Date(),
            isGenerated: false,
          },
        });
      } else {
        await this.prisma.deathNoteGeneration.update({
          where: { userId },
          data: { isGenerated: false },
        });
      }

      await this.processMatches(userId, false, taskId);

      const updatedGeneration = await this.prisma.deathNoteGeneration.findUnique({
        where: { userId },
      });

      return {
        userId,
        isGenerated: updatedGeneration?.isGenerated || false,
        estimatedEndTime: null,
      };
    } catch (error) {
      this.logger.error(`Error requesting death note generation by user ID:`, error);
      throw error;
    }
  }

  /**
   * 强制重新生成死亡笔记（清除旧数据后完全重建）
   */
  async forceGenerateDeathNote(userId: string, taskId?: string): Promise<DeathNoteGenerationResult> {
    try {
      await this.prisma.deathNoteGeneration.deleteMany({ where: { userId } });
      await this.prisma.userMatch.deleteMany({ where: { userId } });

      this.logger.log(`Force generating death note for user ${userId}...`);

      const matchIds = await this.matchService.getUserMatchHistory(userId);
      this.logger.log(`Found ${matchIds.length} matches for user ${userId}`);

      await this.updateProgress(taskId, 5);
      await this.fetchAllMatches(matchIds, taskId);

      if (taskId && await this.taskService.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled after fetchAllMatches, aborting force generation`);
        throw new Error('Task was cancelled');
      }

      this.logger.log(`All matches fetched, processing local match data...`);
      await this.updateProgress(taskId, 40);

      const localMatchFiles = this.matchService.getLocalMatchFiles();
      this.logger.log(`Found ${localMatchFiles.length} local match files`);

      await this.processLocalMatches(userId, localMatchFiles, taskId);

      if (taskId && await this.taskService.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled after processLocalMatches, aborting force generation`);
        throw new Error('Task was cancelled');
      }

      await this.prisma.deathNoteGeneration.upsert({
        where: { userId },
        update: {
          isGenerated: true,
          actualEndTime: new Date(),
        },
        create: {
          userId,
          requestTime: new Date(),
          isGenerated: true,
          actualEndTime: new Date(),
        },
      });

      await this.updateProgress(taskId, 100);
      this.logger.log(`Force death note generation completed for user ${userId}`);

      return { userId, isGenerated: true };
    } catch (error) {
      this.logger.error(`Error force generating death note:`, error);
      throw error;
    }
  }

  /**
   * 计算预估完成时间
   * @param newMatchesCount 新增比赛数量
   * @param firstGenerationDuration 首次生成耗时（毫秒）
   */
  private calculateEstimatedEndTime(newMatchesCount: number, firstGenerationDuration: number | null): Date | null {
    if (newMatchesCount === 0) {
      return new Date();
    }
    
    let avgTimePerMatch: number;
    
    if (firstGenerationDuration && firstGenerationDuration > 0) {
      avgTimePerMatch = firstGenerationDuration / newMatchesCount;
    } else {
      avgTimePerMatch = 5000;
    }
    
    const estimatedDuration = newMatchesCount * avgTimePerMatch;
    return new Date(Date.now() + estimatedDuration);
  }

  /**
   * 获取死亡笔记生成状态
   */
  async getDeathNoteGenerationStatus(userId: string): Promise<DeathNoteStatusResult> {
    try {
      const generation = await this.prisma.deathNoteGeneration.findUnique({
        where: { userId },
      });

      if (!generation) {
        throw new Error(`No death note generation record found for user ${userId}`);
      }

      return {
        isGenerated: generation.isGenerated,
        estimatedEndTime: generation.estimatedEndTime,
        actualEndTime: generation.actualEndTime,
        firstGenerationDuration: generation.firstGenerationDuration,
      };
    } catch (error) {
      this.logger.error(`Error getting death note generation status:`, error);
      throw error;
    }
  }

  /**
   * 获取死亡笔记数据
   */
  async getDeathNoteData(userId: string): Promise<DeathNoteDataResult> {
    try {
      const generation = await this.prisma.deathNoteGeneration.findUnique({
        where: { userId },
      });

      if (!generation?.isGenerated) {
        throw new Error(`Death note not generated for user ${userId}`);
      }

      const user = await this.prisma.user.findFirst({
        where: { pubgId: userId },
      });

      if (!user) {
        throw new Error(`User not found for ID ${userId}`);
      }

      const killEvents = await this.prisma.killEvent.findMany({
        where: {
          OR: [
            { killerId: userId },
            { victimId: userId },
          ],
        },
        orderBy: { timestamp: 'desc' },
        include: {
          match: {
            select: {
              playedAt: true,
              mapName: true,
              gameMode: true,
            },
          },
        },
      });

      return {
        userId,
        nickname: user.nickname,
        totalKills: killEvents.filter(e => e.killerId === userId).length,
        totalDeaths: killEvents.filter(e => e.victimId === userId).length,
        killEvents,
        lastUpdated: generation.actualEndTime,
      };
    } catch (error) {
      this.logger.error(`Error getting death note data:`, error);
      throw error;
    }
  }

  /**
   * 处理用户的所有比赛（增量或全量）
   */
  private async processMatches(userId: string, isIncremental: boolean, taskId?: string): Promise<void> {
    const generation = await this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });

    if (!generation) {
      this.logger.error(`No death note generation record found for user ${userId}`);
      return;
    }

    const matchIds = await this.matchService.getUserMatchHistory(userId);
    this.logger.log(`Found ${matchIds.length} matches for user ${userId}`);

    let matchesToProcess = matchIds;
    const failedMatches: FailedMatch[] = [];

    if (isIncremental) {
      const existingMatches = await this.prisma.userMatch.findMany({
        where: { userId },
        select: { matchId: true },
      });
      const existingMatchIds = new Set(existingMatches.map(m => m.matchId));
      matchesToProcess = matchIds.filter(id => !existingMatchIds.has(id));
      this.logger.log(`Incremental update: ${matchesToProcess.length} new matches to process (out of ${matchIds.length} total)`);
    }

    await this.processMatchList(userId, matchesToProcess, failedMatches, taskId);

    if (taskId && await this.taskService.isTaskCancelled(taskId)) {
      this.logger.log(`Task ${taskId} was cancelled, stopping processMatches`);
      return;
    }

    if (failedMatches.length > 0) {
      this.logger.log(`Retrying ${failedMatches.length} failed matches...`);
      await this.retryFailedMatches(userId, failedMatches, taskId);
    }

    if (taskId && await this.taskService.isTaskCancelled(taskId)) {
      this.logger.log(`Task ${taskId} was cancelled, skipping final update`);
      return;
    }

    try {
      await this.prisma.deathNoteGeneration.update({
        where: { userId },
        data: {
          isGenerated: true,
          actualEndTime: new Date(),
          firstGenerationDuration: Date.now() - generation.requestTime.getTime(),
        },
      });
    } catch (error) {
      this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted during processing, skipping final update`);
    }

    await this.cleanupProgress(userId);
    await this.updateProgress(taskId, 100);
    this.logger.log(`Death note generation completed for user ${userId}. Processed ${matchesToProcess.length - failedMatches.length} matches.`);
  }

  /**
   * 增量更新（用户手动或定时任务）
   */
  async incrementalUpdate(userId: string, taskId?: string): Promise<DeathNoteGenerationResult> {
    const matchIds = await this.matchService.getUserMatchHistory(userId);
    const existingMatches = await this.prisma.userMatch.findMany({
      where: { userId },
      select: { matchId: true },
    });
    const existingMatchIds = new Set(existingMatches.map(m => m.matchId));
    const newMatches = matchIds.filter(id => !existingMatchIds.has(id));

    if (newMatches.length === 0) {
      this.logger.log(`No new matches for user ${userId}`);
      return { userId, isGenerated: true, estimatedEndTime: null };
    }

    this.logger.log(`Incremental update for user ${userId}: ${newMatches.length} new matches`);

    const failedMatches: FailedMatch[] = [];
    await this.processMatchList(userId, newMatches, failedMatches, taskId);

    if (failedMatches.length > 0) {
      await this.retryFailedMatches(userId, failedMatches, taskId);
    }

    try {
      await this.prisma.deathNoteGeneration.update({
        where: { userId },
        data: {
          lastIncrementalTime: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted during incremental update, skipping final update`);
    }

    await this.cleanupProgress(userId);
    await this.updateProgress(taskId, 100);

    return { userId, isGenerated: true, estimatedEndTime: null };
  }

  /**
   * 断点续传（服务启动时自动调用）
   */
  async resumeGeneration(userId: string, taskId?: string): Promise<DeathNoteGenerationResult> {
    const progress = await this.prisma.deathNoteProgress.findUnique({
      where: { userId },
    });

    if (!progress) {
      throw new Error(`No progress record for user ${userId}`);
    }

    const allMatches = await this.matchService.getUserMatchHistory(userId);
    const processedIds = new Set(JSON.parse(progress.processedMatches) as string[]);
    const remainingMatches = allMatches.filter(id => !processedIds.has(id));

    this.logger.log(`Resuming user ${userId}: ${remainingMatches.length} matches remaining (out of ${allMatches.length} total)`);

    const failedMatches: FailedMatch[] = JSON.parse(progress.failedMatches);
    await this.processMatchListWithProgress(userId, remainingMatches, failedMatches, taskId, processedIds);

    if (failedMatches.length > 0) {
      await this.retryFailedMatches(userId, failedMatches, taskId);
    }

    const generation = await this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });

    if (!generation) {
      this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted during force generation, skipping final update`);
      return { userId, isGenerated: false, estimatedEndTime: null };
    }

    await this.prisma.deathNoteGeneration.update({
      where: { userId },
      data: {
        isGenerated: true,
        actualEndTime: new Date(),
        firstGenerationDuration: Date.now() - generation.requestTime.getTime(),
      },
    });

    await this.cleanupProgress(userId);
    await this.updateProgress(taskId, 100);

    this.logger.log(`Death note generation resumed and completed for user ${userId}`);

    return {
      userId,
      isGenerated: true,
      estimatedEndTime: null,
    };
  }

  /**
   * 保存进度（用于断点续传）
   */
  private async saveProgress(
    userId: string,
    taskId: string,
    processedIds: Set<string>,
    processedCount: number,
    failedMatches: FailedMatch[],
    totalMatches: number,
  ): Promise<void> {
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
      this.taskService.updateHeartbeat(taskId, progress),
    ]);
  }

  /**
   * 清理进度记录
   */
  private async cleanupProgress(userId: string): Promise<void> {
    await this.prisma.deathNoteProgress.deleteMany({
      where: { userId },
    });
  }

  /**
   * 处理比赛列表
   */
  private async processMatchList(
    userId: string,
    matchIds: string[],
    failedMatches: FailedMatch[],
    taskId?: string,
  ): Promise<void> {
    let processedCount = 0;
    const totalMatches = matchIds.length;
    const processedIds = new Set<string>();

    for (const matchId of matchIds) {
      if (taskId && await this.taskService.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled, stopping match processing`);
        return;
      }

      try {
        await this.processSingleMatch(userId, matchId);
        
        processedCount++;
        processedIds.add(matchId);
        
        const progress = totalMatches > 0 ? Math.round((processedCount / totalMatches) * 100) : 100;
        await this.updateProgress(taskId, progress);
        
        if (taskId && processedCount % DEATH_NOTE.HEARTBEAT_INTERVAL === 0) {
          await this.saveProgress(userId, taskId, processedIds, processedCount, failedMatches, totalMatches);
        }
        
        this.logger.log(`Successfully processed match ${matchId} for user ${userId} (${processedCount}/${totalMatches}) - ${progress}%`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error processing match ${matchId}:`, error);
        failedMatches.push({ matchId, error: errorMessage, retryCount: 0 });
      }
    }
  }

  /**
   * 处理比赛列表（带进度跟踪，用于断点续传）
   */
  private async processMatchListWithProgress(
    userId: string,
    matchIds: string[],
    failedMatches: FailedMatch[],
    taskId: string | undefined,
    processedIds: Set<string>,
  ): Promise<void> {
    const progress = await this.prisma.deathNoteProgress.findUnique({
      where: { userId },
    });

    let processedCount = progress?.processedCount || 0;
    const totalMatches = matchIds.length;

    for (const matchId of matchIds) {
      if (taskId && await this.taskService.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled, stopping match processing`);
        return;
      }

      try {
        await this.processSingleMatch(userId, matchId);
        
        processedCount++;
        processedIds.add(matchId);
        
        const progress = totalMatches > 0 ? Math.round((processedCount / totalMatches) * 100) : 100;
        await this.updateProgress(taskId, progress);
        
        if (taskId && processedCount % DEATH_NOTE.HEARTBEAT_INTERVAL === 0) {
          await this.saveProgress(userId, taskId, processedIds, processedCount, failedMatches, totalMatches);
        }
        
        this.logger.log(`Successfully processed match ${matchId} for user ${userId} (${processedCount}/${totalMatches}) - ${progress}%`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error processing match ${matchId}:`, error);
        failedMatches.push({ matchId, error: errorMessage, retryCount: 0 });
      }
    }
  }

  /**
   * 处理单个比赛
   */
  private async processSingleMatch(userId: string, matchId: string): Promise<void> {
    let match = await this.prisma.match.findUnique({ where: { id: matchId } });

    if (!match) {
      this.logger.log(`Match ${matchId} not found, fetching from API...`);
      const matchData = await this.matchService.getMatchOriginalData(matchId);
      match = await this.matchService.saveMatch(matchId, matchData);
    }

    await this.prisma.userMatch.upsert({
      where: {
        userId_matchId: { userId, matchId },
      },
      update: {},
      create: { userId, matchId },
    });

    const matchData = await this.matchService.getMatchOriginalData(matchId);
    if (matchData.telemetryEvents?.length > 0) {
      await this.matchService.parseAndSaveKillEvents(matchId, matchData.telemetryEvents);
    }
  }

  /**
   * 获取所有比赛数据并保存到本地
   */
  private async fetchAllMatches(matchIds: string[], taskId?: string): Promise<void> {
    for (let i = 0; i < matchIds.length; i++) {
      if (taskId && await this.taskService.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled, stopping fetchAllMatches`);
        return;
      }
      const matchId = matchIds[i];
      try {
        this.logger.log(`Fetching match ${matchId} (${i + 1}/${matchIds.length})...`);
        await this.matchService.getMatchOriginalData(matchId);
        
        const progress = 5 + Math.round(((i + 1) / matchIds.length) * 30);
        await this.updateProgress(taskId, progress);
      } catch (error) {
        this.logger.error(`Error fetching match ${matchId}:`, error);
      }
    }
  }

  private async processLocalMatches(userId: string, matchIds: string[], taskId?: string): Promise<void> {
    for (let i = 0; i < matchIds.length; i++) {
      if (taskId && await this.taskService.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled, stopping processLocalMatches`);
        return;
      }
      const matchId = matchIds[i];
      try {
        let match = await this.prisma.match.findUnique({ where: { id: matchId } });

        if (!match) {
          const matchData = await this.matchService.getMatchOriginalData(matchId);
          match = await this.matchService.saveMatch(matchId, matchData);
        }

        const matchData = await this.matchService.getMatchOriginalData(matchId);
        const participants = this.extractParticipants(matchData);
        
        if (participants.includes(userId)) {
          await this.prisma.userMatch.upsert({
            where: {
              userId_matchId: { userId, matchId },
            },
            update: {},
            create: { userId, matchId },
          });
        }

        if (matchData.telemetryEvents?.length > 0) {
          await this.matchService.parseAndSaveKillEvents(matchId, matchData.telemetryEvents);
        }

        const progress = 40 + Math.round(((i + 1) / matchIds.length) * 55);
        await this.updateProgress(taskId, progress);
      } catch (error) {
        this.logger.error(`Error processing match ${matchId}:`, error);
      }
    }
  }

  /**
   * 重试失败的比赛
   */
  private async retryFailedMatches(
    userId: string,
    failedMatches: FailedMatch[],
    taskId?: string,
  ): Promise<void> {
    const matchesToRetry = failedMatches.filter(m => m.retryCount < DEATH_NOTE.MAX_RETRY_COUNT);

    if (matchesToRetry.length === 0) {
      this.logger.log(`No failed matches to retry (all exceeded max retries)`);
      return;
    }

    this.logger.log(`Retrying ${matchesToRetry.length} failed matches (attempt ${matchesToRetry[0]?.retryCount + 1 || 1}/${DEATH_NOTE.MAX_RETRY_COUNT})`);

    for (const failedMatch of matchesToRetry) {
      try {
        this.logger.log(`Retrying match ${failedMatch.matchId}...`);
        await this.processSingleMatch(userId, failedMatch.matchId);
        this.logger.log(`Successfully retried match ${failedMatch.matchId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Retry failed for match ${failedMatch.matchId}:`, error);
        failedMatch.retryCount++;
        failedMatch.error = errorMessage;
      }
    }

    const stillFailed = failedMatches.filter(m => m.retryCount < DEATH_NOTE.MAX_RETRY_COUNT && m.error);
    if (stillFailed.length > 0) {
      this.logger.warn(`${stillFailed.length} matches still failed after retry: ${stillFailed.map(m => m.matchId).join(', ')}`);
    }
  }

  /**
   * 从比赛数据中提取参与者 ID 列表
   */
  private extractParticipants(matchData: any): string[] {
    const participants = new Set<string>();
    
    if (matchData.included && Array.isArray(matchData.included)) {
      for (const item of matchData.included) {
        if (item.type === 'participant' && item.attributes?.stats?.playerId) {
          participants.add(item.attributes.stats.playerId);
        }
      }
    }
    
    return Array.from(participants);
  }

  /**
   * 更新任务进度
   */
  private async updateProgress(taskId: string | undefined, progress: number): Promise<void> {
    if (!taskId) return;
    try {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { progress },
      });
    } catch (error) {
      this.logger.error(`Error updating task progress for ${taskId}:`, error);
    }
  }
}
