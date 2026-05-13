// src/pubg/pubg-death-note.service.ts
import { Injectable } from '@nestjs/common';
import { PubgMatchService } from './pubg-match.service';
import { PubgUserService } from './pubg-user.service';
import { TaskService } from '../task/task.service';
import { ExecutableTask, getCurrentTaskContext, isTaskCancelled } from '../task/task.decorator';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { DEATH_NOTE } from '../constants';
import { cache } from '../common/cache.utils';
import {
  DeathNoteGenerationResult,
  FailedMatch,
  UserMatchInfo,
} from './pubg-death-note.types';
import { MatchDataResult } from './pubg.interfaces';
import { DeathNoteProgressService } from './pubg-death-note-progress.service';
import { DeathNoteGenerationService } from './death-note-generation.service';
import { UserMatchService } from './user-match.service';
import { KillEventService } from './kill-event.service';

// ============================================================
// 类型定义
// ============================================================

/** 任务结果中解析出的比赛数量信息 */
interface TaskResultMatchInfo {
  matchCount?: number;
}

// ============================================================
// 服务实现
// ============================================================

@Injectable()
export class PubgDeathNoteService {
  constructor(
    private readonly matchService: PubgMatchService,
    private readonly userService: PubgUserService,
    private readonly taskService: TaskService,
    private readonly progressService: DeathNoteProgressService,
    private readonly generationService: DeathNoteGenerationService,
    private readonly userMatchService: UserMatchService,
    private readonly killEventService: KillEventService,
    private readonly logger: DualOutputLoggerService,
  ) {}

  // ============================================================
  // 公开 API - 任务方法（带装饰器）
  // ============================================================

  /**
   * 请求生成死亡笔记（通过用户 ID）
   * 
   * 功能说明：
   * - 仅用于初次生成死亡笔记，已生成则抛出冲突异常
   * - 通过 PUBG API 获取用户所有比赛历史
   * - 逐场解析比赛遥测数据，提取击杀事件
   * - 支持失败重试机制
   * 
   * 执行流程：
   * 1. 检查生成记录状态，防止重复生成
   * 2. 创建或重置生成记录（标记为生成中）
   * 3. 获取用户比赛历史
   * 4. 计算预估耗时
   * 5. 处理所有比赛（解析遥测数据）
   * 6. 重试失败的比赛
   * 7. 完成生成标记
   * 8. 清理进度记录
   * 9. 清除缓存
   * 
   * @param userId - PUBG 玩家 ID
   * @returns 生成结果，包含用户信息和处理统计
   * @throws Error 当死亡笔记已生成时抛出冲突异常
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
    // 步骤 1：检查生成记录状态
    const generation = await this.generationService.findByUserId(userId);

    // 已生成则抛出冲突异常
    if (generation?.isGenerated) {
      throw new Error(`Death note already generated for user ${userId}`);
    }

    // 步骤 2：创建或重置生成记录
    if (!generation) {
      await this.generationService.create(userId, { isGenerated: false });
    } else {
      await this.generationService.reset(userId);
    }

    // 步骤 3：获取用户比赛历史
    const matchIds = await this.matchService.getUserMatchHistory(userId);
    this.logger.log(`Found ${matchIds.length} matches for user ${userId}`);

    // 步骤 4：计算预估耗时
    const estimatedDuration = await this.calculateEstimatedDuration(matchIds.length);

    // 步骤 5-6：处理所有比赛并重试失败
    const { processedCount } = await this.processMatchesWithRetry(userId, matchIds);

    // 步骤 7-9：完成生成、清理进度、清除缓存
    const nickname = await this.finalizeAndCleanup(userId);

    this.logger.log(`Death note generation completed for user ${userId}. Processed ${processedCount} matches.`);

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
    // 步骤 1：记录当前用户所有比赛 ID 和完整信息
    const existingMatches = await this.userMatchService.findAllByUserId(userId);
    const existingMatchIds = new Set(existingMatches.map(m => m.matchId));
    this.logger.log(`User ${userId} has ${existingMatchIds.size} existing matches`);

    // 步骤 2：删除生成记录和用户比赛关联（重置状态）
    await this.generationService.deleteByUserId(userId);
    await this.userMatchService.deleteByUserId(userId);

    // 步骤 3：从 API 获取最近比赛列表
    const apiMatchIds = await this.matchService.getUserMatchHistory(userId);
    this.logger.log(`API returned ${apiMatchIds.length} matches for user ${userId}`);

    const apiMatchIdSet = new Set(apiMatchIds);
    const oldMatches = existingMatches.filter(m => !apiMatchIdSet.has(m.matchId));
    this.logger.log(`Found ${oldMatches.length} old matches that API no longer returns`);

    // 创建新记录标记生成中
    await this.generationService.create(userId, { isGenerated: false });

    // 步骤 4：强制重新处理 API 返回的比赛（forceReparse=true）
    const { processedCount: apiProcessedCount } = await this.processMatchesWithRetry(userId, apiMatchIds, true);

    // 步骤 5：恢复 API 已无法提供的老比赛关联
    if (oldMatches.length > 0) {
      this.logger.log(`Restoring ${oldMatches.length} old match associations...`);
      await this.restoreOldMatchAssociations(userId, oldMatches);
    }

    // 步骤 6：完成生成、清理进度、清除缓存
    const nickname = await this.finalizeAndCleanup(userId);

    const totalMatches = apiMatchIds.length + oldMatches.length;
    const processedCount = apiProcessedCount + oldMatches.length;

    this.logger.log(`Force generation completed for user ${userId}. Total: ${totalMatches} matches.`);

    return {
      userId,
      nickname,
      isGenerated: true,
      totalMatches,
      processedMatches: processedCount,
    };
  }

  /**
   * 增量更新（用户手动或定时任务）
   * 
   * 功能说明：
   * - 仅用于已生成死亡笔记的用户，未生成则抛出异常
   * - 从 PUBG API 获取最新比赛列表
   * - 仅处理本地不存在的新比赛
   * - 支持失败重试机制
   * 
   * 执行流程：
   * 1. 检查用户是否已生成死亡笔记
   * 2. 获取 API 最新比赛列表
   * 3. 过滤出未处理的新比赛
   * 4. 处理新比赛（解析遥测数据）
   * 5. 重试失败的比赛
   * 6. 更新生成状态
   * 7. 清理进度记录
   * 8. 清除缓存
   * 
   * @param userId - PUBG 玩家 ID
   * @returns 更新结果，包含用户信息和处理统计
   * @throws Error 当用户未生成死亡笔记时抛出异常
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
    // 步骤 1：检查用户是否已生成死亡笔记
    const generation = await this.generationService.findByUserId(userId);
    if (!generation) {
      throw new Error(`Death note not generated for user ${userId}. Please generate first before incremental update.`);
    }

    // 步骤 2：获取 API 最新比赛列表
    const matchIds = await this.matchService.getUserMatchHistory(userId);

    // 步骤 3：过滤出未处理的新比赛
    const existingMatchIds = new Set(await this.userMatchService.findMatchIdsByUserId(userId));
    const matchesToProcess = matchIds.filter(id => !existingMatchIds.has(id));

    this.logger.log(`Incremental update: ${matchesToProcess.length} new matches to process (out of ${matchIds.length} total)`);

    // 步骤 4-5：处理新比赛并重试失败
    const { processedCount } = await this.processMatchesWithRetry(userId, matchesToProcess);

    // 步骤 6-8：完成生成、清理进度、清除缓存
    const nickname = await this.finalizeAndCleanup(userId);

    this.logger.log(`Incremental update completed for user ${userId}. Processed ${processedCount} matches.`);

    return {
      userId,
      nickname,
      isGenerated: true,
      totalMatches: matchIds.length,
      processedMatches: processedCount,
    };
  }

  /**
   * 断点续传（服务启动时自动调用）
   * 
   * 功能说明：
   * - 服务重启时自动恢复未完成的死亡笔记生成任务
   * - 从进度记录中恢复已处理的比赛列表
   * - 继续处理剩余的比赛
   * - 支持失败重试机制
   * 
   * 执行流程：
   * 1. 获取进度记录
   * 2. 获取用户最新比赛列表
   * 3. 计算剩余未处理的比赛
   * 4. 处理剩余比赛
   * 5. 重试失败的比赛
   * 6. 更新生成状态
   * 7. 清理进度记录
   * 8. 清除缓存
   * 
   * @param userId - PUBG 玩家 ID
   * @returns 生成结果，包含用户信息和处理统计
   * @throws Error 当没有进度记录时抛出异常
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
    // 步骤 1：获取进度记录
    const progress = await this.progressService.getProgress(userId);

    if (!progress) {
      throw new Error(`No progress record for user ${userId}`);
    }

    // 步骤 2：获取用户最新比赛列表
    const allMatches = await this.matchService.getUserMatchHistory(userId);
    const processedIds = new Set<string>(progress.processedMatches);
    const remainingMatches = allMatches.filter(id => !processedIds.has(id));

    this.logger.log(`Resuming user ${userId}: ${remainingMatches.length} matches remaining (out of ${allMatches.length} total)`);

    // 步骤 3-4：处理剩余比赛并重试失败（从断点恢复）
    const { processedCount } = await this.processMatchesWithRetry(
      userId,
      remainingMatches,
      false,
      processedIds,
      progress.processedCount,
      progress.failedMatches,
    );

    // 步骤 5-8：完成生成、清理进度、清除缓存
    const generation = await this.generationService.findByUserId(userId);

    if (!generation) {
      this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted during processing, skipping final update`);
      return { userId, nickname: '', isGenerated: false, totalMatches: allMatches.length, processedMatches: 0 };
    }

    const nickname = await this.finalizeAndCleanup(userId);

    this.logger.log(`Death note generation resumed and completed for user ${userId}. Processed ${processedCount} matches.`);

    return {
      userId,
      nickname,
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
    return this.userService.getUserIdByNickname(nickname);
  }

  /**
   * 检查用户是否已生成死亡笔记
   */
  async hasDeathNoteGeneration(userId: string): Promise<boolean> {
    return this.generationService.exists(userId);
  }

  /**
   * 获取死亡笔记生成状态
   */
  async getDeathNoteGenerationStatus(userId: string) {
    return this.generationService.getGenerationStatus(userId);
  }

  /**
   * 获取死亡笔记数据
   */
  async getDeathNoteData(userId: string) {
    const generation = await this.generationService.findByUserId(userId);

    if (!generation?.isGenerated) {
      throw new Error(`Death note not generated for user ${userId}`);
    }

    return this.killEventService.getDeathNoteData(userId, generation.createdAt);
  }

  /**
   * 获取所有死亡笔记概览
   */
  async getAllDeathNotes() {
    return this.generationService.getAllOverviews();
  }

  // ============================================================
  // 私有方法 - 比赛处理
  // ============================================================

  /**
   * 处理比赛列表并重试失败的比赛
   * 
   * 功能说明：
   * - 封装 processMatchList + retryFailedMatches 的通用流程
   * - 返回处理结果统计
   * 
   * @param userId - 用户 ID
   * @param matchIds - 待处理的比赛 ID 列表
   * @param forceReparse - 是否强制重新解析
   * @param initialProcessedIds - 初始已处理 ID 集合（断点续传时使用）
   * @param initialProcessedCount - 初始已处理数量（断点续传时使用）
   * @param initialFailedMatches - 初始失败列表（断点续传时使用）
   * @returns 处理结果，包含成功处理数量
   */
  private async processMatchesWithRetry(
    userId: string,
    matchIds: string[],
    forceReparse = false,
    initialProcessedIds?: Set<string>,
    initialProcessedCount?: number,
    initialFailedMatches: FailedMatch[] = [],
  ): Promise<{ processedCount: number }> {
    const failedMatches: FailedMatch[] = [...initialFailedMatches];

    // 处理比赛列表
    await this.processMatchList(userId, matchIds, failedMatches, initialProcessedIds, initialProcessedCount, forceReparse);

    // 重试失败的比赛
    getCurrentTaskContext()?.checkCancelled();

    if (failedMatches.length > 0) {
      this.logger.log(`Retrying ${failedMatches.length} failed matches...`);
      await this.retryFailedMatches(userId, failedMatches);
    }

    // 计算成功处理数量
    const successfullyProcessed = matchIds.length + (initialProcessedCount ?? 0)
      - failedMatches.filter(m => m.retryCount >= DEATH_NOTE.MAX_RETRY_COUNT).length;

    return { processedCount: successfullyProcessed };
  }

  /**
   * 完成生成并清理
   * 
   * 功能说明：
   * - 封装 finalizeGeneration + cleanupProgress + invalidateDeathNoteCache 的通用流程
   * - 返回用户昵称
   * 
   * @param userId - 用户 ID
   * @returns 用户昵称
   */
  private async finalizeAndCleanup(userId: string): Promise<string> {
    await this.finalizeGeneration(userId);
    await this.progressService.cleanupProgress(userId);
    return this.invalidateDeathNoteCache(userId);
  }

  /**
   * 处理比赛列表
   * 
   * 功能说明：
   * - 遍历比赛 ID 列表，逐个处理比赛
   * - 实时更新任务进度（百分比）
   * - 定期保存进度记录（用于断点续传）
   * - 收集失败的比赛信息（用于后续重试）
   * 
   * 进度计算逻辑：
   * - processedCount 记录已尝试处理的比赛数量（无论成功或失败）
   * - 进度百分比 = (已尝试数 / 总数) × 100%
   * - 这样确保即使所有比赛都失败，进度也能达到 100%
   * 
   * 参数说明：
   * @param userId - 用户 ID
   * @param matchIds - 待处理的比赛 ID 列表
   * @param failedMatches - 失败比赛收集数组（会被修改）
   * @param initialProcessedIds - 初始已处理 ID 集合（断点续传时使用）
   * @param initialProcessedCount - 初始已处理数量（断点续传时使用）
   * @param forceReparse - 是否强制重新解析（忽略本地缓存）
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
      // 检查任务是否被取消
      context?.checkCancelled();

      try {
        // 处理单个比赛
        await this.processSingleMatch(userId, matchId, forceReparse);

        // 记录成功处理的比赛
        processedIds.add(matchId);
      } catch (error) {
        // 任务取消异常直接抛出
        if (isTaskCancelled(error)) throw error;

        // 收集失败信息
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error processing match ${matchId}:`, error);
        failedMatches.push({ matchId, error: errorMessage, retryCount: 0 });
      } finally {
        // 无论成功或失败，都计入已处理数量
        processedCount++;

        // 计算并更新进度百分比
        const progress = totalMatches > 0 ? Math.round((processedCount / totalMatches) * 100) : 100;
        await this.updateProgress(taskId, progress);

        // 定期保存进度（用于断点续传）
        if (processedCount % DEATH_NOTE.HEARTBEAT_INTERVAL === 0) {
          await this.progressService.saveProgress(userId, taskId, processedIds, processedCount, failedMatches, totalMatches);
        }
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
    const matchExists = await this.matchService.exists(matchId);
    let matchData: MatchDataResult;

    if (!matchExists || forceReparse) {
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
    await this.userMatchService.upsert(userId, matchId, participantInfo.ranking, participantInfo.won);

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
  // 私有方法 - 缓存管理
  // ============================================================

  /**
   * 清除用户的死亡笔记缓存
   * @param userId - PUBG 玩家 ID
   * @returns 用户昵称
   */
  private async invalidateDeathNoteCache(userId: string): Promise<string> {
    const user = await this.userService.getUserById(userId);
    await cache.invalidatePattern(`deathnote:${user.name}:`);
    return user.name;
  }

  // ============================================================
  // 私有方法 - 进度管理
  // ============================================================

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
      await this.generationService.updateIsGenerated(userId, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DeathNoteGeneration record for user ${userId} was deleted during processing, skipping final update: ${errorMessage}`);
    }
  }

  /**
   * 恢复老比赛关联
   */
  private async restoreOldMatchAssociations(userId: string, oldMatches: UserMatchInfo[]): Promise<void> {
    await this.userMatchService.createManyWithInfo(userId, oldMatches);
    this.logger.log(`Restored ${oldMatches.length} old match associations for user ${userId}`);
  }

  /**
   * 计算预估用时
   * @param matchCount 比赛数量
   * @returns 预估用时（毫秒）
   */
  private async calculateEstimatedDuration(matchCount: number): Promise<number> {
    const tasks = await this.taskService.getCompletedDeathNoteTasks();

    if (tasks.length === 0) {
      return 5000 * matchCount;
    }

    let totalDuration = 0;
    let totalMatches = 0;

    for (const task of tasks) {
      if (!task.startedAt || !task.completedAt) continue;

      totalDuration += task.completedAt.getTime() - task.startedAt.getTime();

      const matchInfo = this.parseTaskResult(task.result);
      if (matchInfo?.matchCount) {
        totalMatches += matchInfo.matchCount;
      }
    }

    const avgTimePerMatch = totalMatches > 0 ? totalDuration / totalMatches : 5000;
    return avgTimePerMatch * matchCount;
  }

  /**
   * 解析任务结果中的比赛数量
   */
  private parseTaskResult(result: string | null): TaskResultMatchInfo | null {
    if (!result) return null;

    try {
      return JSON.parse(result) as TaskResultMatchInfo;
    } catch {
      return null;
    }
  }

}
