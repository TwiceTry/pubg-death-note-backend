// src/pubg/pubg-death-note.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgMatchService } from './pubg-match.service';
import { TaskService, TaskStatus } from '../task/task.service';
import { ExecutableTask, getCurrentTaskContext, isTaskCancelled } from '../task/task.decorator';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import { cache } from '../common/cache.utils';
import {
  DeathNoteGenerationResult,
  DeathNoteStatusResult,
  DeathNoteDataResult,
  FailedMatch,
} from './pubg-death-note.types';
import { MatchDataResult } from './pubg.interfaces';

// ============================================================
// 类型定义
// ============================================================

/** 任务结果中解析出的比赛数量信息 */
interface TaskResultMatchInfo {
  matchCount?: number;
}

/** 预估用时计算缓存 */
interface DurationEstimate {
  avgTimePerMatch: number;
}

// ============================================================
// 服务实现
// ============================================================

@Injectable()
export class PubgDeathNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matchService: PubgMatchService,
    private readonly taskService: TaskService,
    private readonly logger: DualOutputLoggerService,
  ) {}

  // ============================================================
  // 公开 API - 任务方法（带装饰器）
  // ============================================================

  /**
   * 请求生成死亡笔记（通过用户 ID）
   * 仅用于初次生成，已生成则抛出冲突异常
   */
  @ExecutableTask({
    type: 'death_note_generate',
    getUserId: (args) => args[0] as string,
    async: true,
    buildResult: (result) => ({
      success: true,
      message: 'Death note generation completed',
      ...(result as Record<string, unknown>),
    }),
  })
  async requestDeathNoteGenerationByUserId(userId: string): Promise<DeathNoteGenerationResult> {
    const generation = await this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });

    if (generation?.isGenerated) {
      throw new Error(`Death note already generated for user ${userId}`);
    }

    if (!generation) {
      await this.prisma.deathNoteGeneration.create({
        data: { userId, isGenerated: false },
      });
    } else {
      await this.prisma.deathNoteGeneration.update({
        where: { userId },
        data: { isGenerated: false },
      });
    }

    const matchIds = await this.matchService.getUserMatchHistory(userId);
    this.logger.log(`Found ${matchIds.length} matches for user ${userId}`);

    const estimatedDuration = await this.calculateEstimatedDuration(matchIds.length);

    const failedMatches: FailedMatch[] = [];
    await this.processMatchList(userId, matchIds, failedMatches);

    if (failedMatches.length > 0) {
      this.logger.log(`Retrying ${failedMatches.length} failed matches...`);
      await this.retryFailedMatches(userId, failedMatches);
    }

    await this.finalizeGeneration(userId);
    await this.cleanupProgress(userId);

    const processedCount = matchIds.length - failedMatches.length;
    this.logger.log(`Death note generation completed for user ${userId}. Processed ${processedCount} matches.`);

    // 清除该用户的死亡笔记缓存
    await cache.invalidatePattern(`deathnote:${userId}:`);

    const nickname = await this.getUserNickname(userId);

    return {
      userId,
      nickname,
      isGenerated: true,
      estimatedDuration,
      totalMatches: matchIds.length,
      processedMatches: processedCount,
    };
  }

  /**
   * 强制重新生成死亡笔记
   *
   * 设计说明：
   * PUBG API 仅返回最近 14 天的比赛数据。如果直接删除所有旧数据再重新生成，
   * 会导致 14 天之前的历史比赛永久丢失。
   *
   * 因此"强制"的定义为：重新从 API 拉取并重新解析所有能获取到的数据，
   * 但保留 API 已无法提供的历史比赛数据。
   *
   * 流程：
   * 1. 记录当前用户所有比赛 ID，区分"API 可能仍能提供"和"API 已无法提供"的
   * 2. 删除 deathNoteGeneration 和 userMatch（重置状态和关联）
   * 3. 从 API 获取最近比赛列表
   * 4. 对 API 返回的比赛：强制重新拉取 telemetry 并重新解析 killEvent
   * 5. 恢复"API 已无法提供"的老比赛的 userMatch 关联
   * 6. 更新生成状态
   */
  @ExecutableTask({
    type: 'death_note_force_generate',
    getUserId: (args) => args[0] as string,
    forceCancelRunningTask: true,
    async: true,
    buildResult: (result) => ({
      success: true,
      message: `Force generation completed. Total: ${(result as DeathNoteGenerationResult)?.totalMatches ?? 0} matches.`,
      ...(result as Record<string, unknown>),
    }),
  })
  async forceGenerateDeathNote(userId: string): Promise<DeathNoteGenerationResult> {
    // 步骤 1：记录当前用户所有比赛 ID
    const existingUserMatches = await this.prisma.userMatch.findMany({
      where: { userId },
      select: { matchId: true },
    });
    const existingMatchIds = new Set(existingUserMatches.map(m => m.matchId));
    this.logger.log(`User ${userId} has ${existingMatchIds.size} existing matches`);

    // 步骤 2：删除生成记录和用户比赛关联（重置状态）
    await this.prisma.deathNoteGeneration.deleteMany({ where: { userId } });
    await this.prisma.userMatch.deleteMany({ where: { userId } });

    // 步骤 3：从 API 获取最近比赛列表
    const apiMatchIds = await this.matchService.getUserMatchHistory(userId);
    this.logger.log(`API returned ${apiMatchIds.length} matches for user ${userId}`);

    const apiMatchIdSet = new Set(apiMatchIds);
    const oldMatchIds = [...existingMatchIds].filter(id => !apiMatchIdSet.has(id));
    this.logger.log(`Found ${oldMatchIds.length} old matches that API no longer returns`);

    // 创建新记录标记生成中
    await this.prisma.deathNoteGeneration.create({
      data: { userId, isGenerated: false },
    });

    // 步骤 4：强制重新处理 API 返回的比赛（forceReparse=true）
    const failedMatches: FailedMatch[] = [];
    await this.processMatchList(userId, apiMatchIds, failedMatches, undefined, undefined, true);

    // 重试失败的比赛
    if (failedMatches.length > 0) {
      this.logger.log(`Retrying ${failedMatches.length} failed matches...`);
      await this.retryFailedMatches(userId, failedMatches);
    }

    // 步骤 5：恢复 API 已无法提供的老比赛关联
    if (oldMatchIds.length > 0) {
      this.logger.log(`Restoring ${oldMatchIds.length} old match associations...`);
      await this.restoreOldMatchAssociations(userId, oldMatchIds);
    }

    // 步骤 6：更新生成状态
    await this.prisma.deathNoteGeneration.update({
      where: { userId },
      data: { isGenerated: true },
    });

    await this.cleanupProgress(userId);

    const totalMatches = apiMatchIds.length + oldMatchIds.length;
    const processedCount = apiMatchIds.length - failedMatches.length + oldMatchIds.length;

    this.logger.log(`Force generation completed for user ${userId}. Total: ${totalMatches} matches.`);

    // 清除该用户的死亡笔记缓存
    await cache.invalidatePattern(`deathnote:${userId}:`);

    const nickname = await this.getUserNickname(userId);

    return { userId, nickname, isGenerated: true, totalMatches, processedMatches: processedCount };
  }

  /**
   * 增量更新（用户手动或定时任务）
   * 仅用于已生成过的用户，未生成则抛出异常
   */
  @ExecutableTask({
    type: 'death_note_incremental_update',
    getUserId: (args) => args[0] as string,
    async: true,
    buildResult: (result) => ({
      success: true,
      message: 'Incremental update completed',
      ...(result as Record<string, unknown>),
    }),
  })
  async incrementalUpdate(userId: string): Promise<DeathNoteGenerationResult> {
    const matchIds = await this.matchService.getUserMatchHistory(userId);

    const existingMatches = await this.prisma.userMatch.findMany({
      where: { userId },
      select: { matchId: true },
    });
    const existingMatchIds = new Set(existingMatches.map(m => m.matchId));
    const matchesToProcess = matchIds.filter(id => !existingMatchIds.has(id));

    this.logger.log(`Incremental update: ${matchesToProcess.length} new matches to process (out of ${matchIds.length} total)`);

    const failedMatches: FailedMatch[] = [];
    await this.processMatchList(userId, matchesToProcess, failedMatches);

    if (failedMatches.length > 0) {
      this.logger.log(`Retrying ${failedMatches.length} failed matches...`);
      await this.retryFailedMatches(userId, failedMatches);
    }

    await this.finalizeGeneration(userId);
    await this.cleanupProgress(userId);

    const processedCount = matchesToProcess.length - failedMatches.length;
    this.logger.log(`Incremental update completed for user ${userId}. Processed ${processedCount} matches.`);

    // 清除该用户的死亡笔记缓存
    await cache.invalidatePattern(`deathnote:${userId}:`);

    const nickname = await this.getUserNickname(userId);

    return {
      userId,
      nickname,
      isGenerated: true,
      totalMatches: matchesToProcess.length,
      processedMatches: processedCount,
    };
  }

  /**
   * 断点续传（服务启动时自动调用）
   */
  @ExecutableTask({
    type: 'death_note_resume',
    getUserId: (args) => args[0] as string,
    buildResult: (result, args) => ({
      success: true,
      message: `Death note generation resumed and completed for user ${args[0] as string}. Processed ${(result as DeathNoteGenerationResult)?.processedMatches ?? 0} matches.`,
      ...(result as Record<string, unknown>),
    }),
  })
  async resumeGeneration(userId: string): Promise<DeathNoteGenerationResult> {
    const progress = await this.prisma.deathNoteProgress.findUnique({
      where: { userId },
    });

    if (!progress) {
      throw new Error(`No progress record for user ${userId}`);
    }

    const allMatches = await this.matchService.getUserMatchHistory(userId);
    const processedIds = new Set<string>(JSON.parse(progress.processedMatches) as string[]);
    const remainingMatches = allMatches.filter(id => !processedIds.has(id));

    this.logger.log(`Resuming user ${userId}: ${remainingMatches.length} matches remaining (out of ${allMatches.length} total)`);

    const failedMatches: FailedMatch[] = JSON.parse(progress.failedMatches) as FailedMatch[];
    await this.processMatchList(userId, remainingMatches, failedMatches, processedIds, progress.processedCount);

    getCurrentTaskContext()?.checkCancelled();

    if (failedMatches.length > 0) {
      await this.retryFailedMatches(userId, failedMatches);
    }

    getCurrentTaskContext()?.checkCancelled();

    const generation = await this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });

    if (!generation) {
      this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted during processing, skipping final update`);
      return { userId, isGenerated: false };
    }

    await this.prisma.deathNoteGeneration.update({
      where: { userId },
      data: { isGenerated: true },
    });

    await this.cleanupProgress(userId);

    const processedCount = allMatches.length - failedMatches.length;

    this.logger.log(`Death note generation resumed and completed for user ${userId}. Processed ${processedCount} matches.`);

    return {
      userId,
      isGenerated: true,
      totalMatches: allMatches.length,
      processedMatches: processedCount,
    };
  }

  // ============================================================
  // 公开 API - 查询方法
  // ============================================================

  /**
   * 根据昵称获取用户 ID（仅查询数据库）
   */
  async getUserIdByNickname(nickname: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { nickname },
      select: { pubgId: true },
    });
    return user?.pubgId ?? null;
  }

  /**
   * 检查用户是否已生成死亡笔记
   */
  async hasDeathNoteGeneration(userId: string): Promise<boolean> {
    const generation = await this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });
    return !!generation;
  }

  /**
   * 获取死亡笔记生成状态
   */
  async getDeathNoteGenerationStatus(userId: string): Promise<DeathNoteStatusResult> {
    const generation = await this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });

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
   * 获取死亡笔记数据
   */
  async getDeathNoteData(userId: string): Promise<DeathNoteDataResult> {
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
        OR: [{ killerId: userId }, { victimId: userId }],
      },
      orderBy: { timestamp: 'desc' },
      include: {
        match: {
          select: { playedAt: true, mapName: true, gameMode: true },
        },
      },
    });

    return {
      userId,
      nickname: user.nickname,
      totalKills: killEvents.filter(e => e.killerId === userId).length,
      totalDeaths: killEvents.filter(e => e.victimId === userId).length,
      killEvents,
      lastUpdated: generation.createdAt,
    };
  }

  /**
   * 获取所有死亡笔记概览
   */
  async getAllDeathNotes(): Promise<Array<{
    userId: string;
    nickname: string;
    isGenerated: boolean;
    createdAt: Date;
    dailyIncrementalEnabled: boolean;
    latestTaskStatus: string | null;
    latestTaskProgress: number;
    latestTaskType: string | null;
    firstRequestTime: Date;
    lastUpdateTime: Date | null;
  }>> {
    const generations = await this.prisma.deathNoteGeneration.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    const results: Array<{
      userId: string;
      nickname: string;
      isGenerated: boolean;
      createdAt: Date;
      dailyIncrementalEnabled: boolean;
      latestTaskStatus: string | null;
      latestTaskProgress: number;
      latestTaskType: string | null;
      firstRequestTime: Date;
      lastUpdateTime: Date | null;
    }> = [];

    for (const gen of generations) {
      const nickname = await this.getUserNickname(gen.userId);
      const firstTask = await this.prisma.task.findFirst({
        where: { userId: gen.userId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const latestTask = await this.prisma.task.findFirst({
        where: { userId: gen.userId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, progress: true, type: true, completedAt: true },
      });

      results.push({
        userId: gen.userId,
        nickname,
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

  // ============================================================
  // 私有方法 - 比赛处理
  // ============================================================

  /**
   * 处理比赛列表
   */
  private async processMatchList(
    userId: string,
    matchIds: string[],
    failedMatches: FailedMatch[],
    initialProcessedIds?: Set<string>,
    initialProcessedCount?: number,
    forceReparse = false,
  ): Promise<void> {
    const context = getCurrentTaskContext();
    const taskId = context?.taskId;
    let processedCount = initialProcessedCount ?? 0;
    const totalMatches = matchIds.length;
    const processedIds = initialProcessedIds ?? new Set<string>();

    for (const matchId of matchIds) {
      context?.checkCancelled();

      try {
        await this.processSingleMatch(userId, matchId, forceReparse);

        processedCount++;
        processedIds.add(matchId);

        const progress = totalMatches > 0 ? Math.round((processedCount / totalMatches) * 100) : 100;
        await this.updateProgress(taskId, progress);

        if (processedCount % DEATH_NOTE.HEARTBEAT_INTERVAL === 0) {
          await this.saveProgress(userId, taskId, processedIds, processedCount, failedMatches, totalMatches);
        }

        this.logger.log(`Successfully processed match ${matchId} for user ${userId} (${processedCount}/${totalMatches}) - ${progress}%`);
      } catch (error) {
        if (isTaskCancelled(error)) throw error;

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error processing match ${matchId}:`, error);
        failedMatches.push({ matchId, error: errorMessage, retryCount: 0 });
      }
    }
  }

  /**
   * 处理单个比赛
   * @param userId 用户 ID
   * @param matchId 比赛 ID
   * @param forceReparse 是否强制重新拉取并解析（忽略本地缓存）
   */
  private async processSingleMatch(userId: string, matchId: string, forceReparse = false): Promise<void> {
    const existingMatch = await this.prisma.match.findUnique({ where: { id: matchId } });
    let matchData: MatchDataResult;

    if (!existingMatch || forceReparse) {
      if (forceReparse) {
        this.logger.log(`Force reprocessing match ${matchId}, fetching fresh data from API...`);
        matchData = await this.matchService.fetchMatchDataFromApi(matchId);
      } else {
        this.logger.log(`Match ${matchId} not found, fetching from API...`);
        matchData = await this.matchService.getMatchOriginalData(matchId);
      }
      await this.matchService.saveMatch(matchId, matchData);
    } else {
      matchData = await this.matchService.getMatchOriginalData(matchId);
    }

    const participants = this.matchService.extractParticipants(matchData);
    const participantInfo = participants.get(userId) || { ranking: 0, won: false };
    await this.prisma.userMatch.upsert({
      where: { userId_matchId: { userId, matchId } },
      update: { ranking: participantInfo.ranking, won: participantInfo.won },
      create: { userId, matchId, ranking: participantInfo.ranking, won: participantInfo.won },
    });

    if (matchData.telemetryEvents?.length > 0) {
      await this.matchService.parseAndSaveKillEvents(matchId, matchData.telemetryEvents);
    }
  }

  /**
   * 重试失败的比赛
   */
  private async retryFailedMatches(userId: string, failedMatches: FailedMatch[]): Promise<void> {
    const matchesToRetry = failedMatches.filter(m => m.retryCount < DEATH_NOTE.MAX_RETRY_COUNT);

    if (matchesToRetry.length === 0) {
      this.logger.log(`No failed matches to retry (all exceeded max retries)`);
      return;
    }

    const currentAttempt = (matchesToRetry[0]?.retryCount ?? 0) + 1;
    this.logger.log(`Retrying ${matchesToRetry.length} failed matches (attempt ${currentAttempt}/${DEATH_NOTE.MAX_RETRY_COUNT})`);

    for (const failedMatch of matchesToRetry) {
      getCurrentTaskContext()?.checkCancelled();

      try {
        this.logger.log(`Retrying match ${failedMatch.matchId}...`);
        await this.processSingleMatch(userId, failedMatch.matchId, true);
        this.logger.log(`Successfully retried match ${failedMatch.matchId}`);
      } catch (error) {
        if (isTaskCancelled(error)) throw error;

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

  // ============================================================
  // 私有方法 - 进度管理
  // ============================================================

  /**
   * 保存进度（用于断点续传）
   */
  private async saveProgress(
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
   * 清理进度记录
   */
  private async cleanupProgress(userId: string): Promise<void> {
    await this.prisma.deathNoteProgress.deleteMany({
      where: { userId },
    });
  }

  /**
   * 更新任务进度
   */
  private async updateProgress(taskId: string | undefined, progress: number): Promise<void> {
    if (!taskId) return;

    try {
      await this.taskService.updateProgress(taskId, progress);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error updating task progress for ${taskId}: ${errorMessage}`);
    }
  }

  // ============================================================
  // 私有方法 - 辅助工具
  // ============================================================

  /**
   * 完成生成记录
   */
  private async finalizeGeneration(userId: string): Promise<void> {
    try {
      await this.prisma.deathNoteGeneration.update({
        where: { userId },
        data: { isGenerated: true },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted during processing, skipping final update: ${errorMessage}`);
    }
  }

  /**
   * 恢复老比赛关联
   */
  private async restoreOldMatchAssociations(userId: string, oldMatchIds: string[]): Promise<void> {
    const userMatchData = oldMatchIds.map(matchId => ({
      userId,
      matchId,
    }));

    await this.prisma.userMatch.createMany({
      data: userMatchData,
    });

    this.logger.log(`Restored ${oldMatchIds.length} old match associations for user ${userId}`);
  }

  /**
   * 计算预估用时
   * @param matchCount 比赛数量
   * @returns 预估用时（毫秒）
   */
  private async calculateEstimatedDuration(matchCount: number): Promise<number> {
    const avgTimePerMatch = await this.getAverageTimePerMatch();
    const timePerMatch = avgTimePerMatch ?? 5000; // 默认 5 秒/比赛
    return timePerMatch * matchCount;
  }

  /**
   * 获取平均每场比赛耗时
   * 优先使用当前用户的历史数据，其次使用全局平均
   */
  private async getAverageTimePerMatch(): Promise<number | null> {
    // 先查询全局已完成任务
    return this.calculateAvgTimeFromTasks({
      status: TaskStatus.COMPLETED,
      type: { contains: 'death_note' },
    });
  }

  /**
   * 从任务记录中计算平均耗时
   */
  private async calculateAvgTimeFromTasks(where: Record<string, unknown>): Promise<number | null> {
    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        startedAt: true,
        completedAt: true,
        result: true,
      },
    });

    if (tasks.length === 0) {
      return null;
    }

    let totalDuration = 0;
    let totalMatches = 0;

    for (const task of tasks) {
      if (!task.startedAt || !task.completedAt) continue;

      const duration = task.completedAt.getTime() - task.startedAt.getTime();
      totalDuration += duration;

      const matchInfo = this.parseTaskResult(task.result);
      if (matchInfo?.matchCount) {
        totalMatches += matchInfo.matchCount;
      }
    }

    if (totalMatches === 0) {
      return null;
    }

    return totalDuration / totalMatches;
  }

  /**
   * 解析任务结果中的比赛数量
   */
  private parseTaskResult(result: string | null): TaskResultMatchInfo | null {
    if (!result) return null;

    try {
      const parsed = JSON.parse(result) as TaskResultMatchInfo;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * 获取用户昵称
   */
  private async getUserNickname(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { pubgId: userId },
        select: { nickname: true },
      });
      return user?.nickname ?? userId;
    } catch {
      return userId;
    }
  }

  /**
   * 从比赛数据中提取参与者 ID 列表
   * 预留供日后功能使用
   */
  private extractParticipants(matchData: MatchDataResult): string[] {
    const participants = new Set<string>();

    const included = (matchData as unknown as Record<string, unknown>)?.included;
    if (Array.isArray(included)) {
      for (const item of included) {
        const record = item as Record<string, unknown>;
        if (record.type === 'participant') {
          const stats = (record.attributes as Record<string, unknown>)?.stats as Record<string, unknown> | undefined;
          const playerId = stats?.playerId as string | undefined;
          if (playerId) {
            participants.add(playerId);
          }
        }
      }
    }

    return Array.from(participants);
  }
}
