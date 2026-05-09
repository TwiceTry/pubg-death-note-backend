// src/pubg/pubg-task.controller.ts
import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { PubgMatchService } from './pubg-match.service';
import { PubgDeathNoteService } from './pubg-death-note.service';
import { PubgUserService } from './pubg-user.service';
import { TaskService } from '../task/task.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { validateNickname, validateUserId, validateMatchId } from '../common/validation.utils';

@UseGuards(AdminAuthGuard)
@Controller('pubg/tasks')
export class PubgTaskController {
  constructor(
    private readonly pubgMatchService: PubgMatchService,
    private readonly pubgDeathNoteService: PubgDeathNoteService,
    private readonly pubgUserService: PubgUserService,
    private readonly taskService: TaskService,
    private readonly logger: DualOutputLoggerService,
  ) {}

  /**
   * 构建成功响应
   * @param data 响应数据
   * @param message 可选的成功消息
   * @returns 标准成功响应对象
   */
  private successResponse(data: Record<string, any>, message?: string): Record<string, any> {
    return {
      success: true,
      ...(message && { message }),
      ...data,
    };
  }

  /**
   * 构建任务创建成功响应
   * @param taskId 任务 ID
   * @param message 成功消息
   * @returns 包含任务 ID 和状态查询 URL 的响应对象
   */
  private taskCreatedResponse(taskId: string, message: string = 'Task created successfully'): Record<string, any> {
    this.logger.log(`Created task: ${taskId} ${message}`);
    return {
      success: true,
      message,
      taskId,
      statusUrl: `/api/v1/pubg/tasks/${taskId}`,
    };
  }

  // ============================================================
  // 比赛重解析
  // ============================================================

  /**
   * 创建用户比赛重解析任务
   * POST /api/v1/pubg/tasks/reparse/user/:userId
   */
  @Post('reparse/user/:userId')
  async createUserReparseTask(@Param('userId') userId: string): Promise<Record<string, any>> {
    validateUserId(userId);

    if (await this.taskService.getRunningTask(userId)) {
      throw new HttpException('User already has a running task', HttpStatus.CONFLICT);
    }

    const result: any = await (this.pubgMatchService as any).reparseUserTelemetryWithProgress(userId);

    return this.taskCreatedResponse(result.taskId, 'User match reparse task created');
  }

  /**
   * 创建全局比赛重解析任务
   * POST /api/v1/pubg/tasks/reparse/all
   */
  @Post('reparse/all')
  async createGlobalReparseTask(): Promise<Record<string, any>> {
    const result: any = await (this.pubgMatchService as any).reparseAllTelemetryWithProgress();

    return this.taskCreatedResponse(result.taskId, 'All match telemetry reparse task created');
  }

  /**
   * 重新解析单个比赛的遥测数据
   * POST /api/v1/pubg/tasks/telemetry/reparse/match/:matchId
   */
  @Post('telemetry/reparse/match/:matchId')
  async reparseMatchTelemetry(@Param('matchId') matchId: string): Promise<Record<string, any>> {
    validateMatchId(matchId);

    const taskId = await this.taskService.createAndExecuteTask(
      'reparse_match',
      async () => {
        const result = await this.pubgMatchService.reparseMatchTelemetry(matchId);
        return { ...result, matchId };
      },
    );

    return this.taskCreatedResponse(taskId, 'Reparse task created');
  }

  // ============================================================
  // 任务查询
  // ============================================================

  /**
   * 获取全局最新任务状态
   * GET /api/v1/pubg/tasks/latest
   */
  @Get('latest')
  async getLatestTask(): Promise<Record<string, any>> {
    const task = await this.taskService.getLatestGlobalTask();

    if (!task) {
      return this.successResponse({ task: null }, 'No global task found');
    }

    return this.successResponse({ task });
  }

  /**
   * 获取所有任务列表（分页）
   * GET /api/v1/pubg/tasks/list?page=1&limit=20
   */
  @Get('list')
  async getAllTasks(@Query('page') page?: string, @Query('limit') limit?: string): Promise<Record<string, any>> {
    const result = await this.taskService.getAllTasks(Number(page) || 1, Number(limit) || 20);
    return this.successResponse(result);
  }

  /**
   * 获取指定任务状态
   * GET /api/v1/pubg/tasks/:taskId
   */
  @Get(':taskId')
  async getTask(@Param('taskId') taskId: string): Promise<Record<string, any>> {
    const task = await this.taskService.getTask(taskId);

    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }

    return this.successResponse({ task });
  }

  /**
   * 获取用户的任务列表
   * GET /api/v1/pubg/tasks/user/:userId
   */
  @Get('user/:userId')
  async getUserTasks(@Param('userId') userId: string): Promise<Record<string, any>> {
    validateUserId(userId);

    const tasks = await this.taskService.getTasksByUserId(userId);

    return this.successResponse({ tasks });
  }

  /**
   * 获取用户最新任务状态
   * GET /api/v1/pubg/tasks/user/:userId/latest
   */
  @Get('user/:userId/latest')
  async getUserLatestTask(@Param('userId') userId: string): Promise<Record<string, any>> {
    validateUserId(userId);

    const task = await this.taskService.getLatestTaskByUserId(userId);

    if (!task) {
      return this.successResponse({ task: null }, 'No task found for this user');
    }

    return this.successResponse({ task });
  }

  /**
   * 通过用户昵称获取最新任务状态
   * GET /api/v1/pubg/tasks/users/nickname/:nickname/task-status
   */
  @Get('users/nickname/:nickname/task-status')
  async getLatestTaskByNickname(@Param('nickname') nickname: string): Promise<Record<string, any>> {
    validateNickname(nickname);

    try {
      const user = await this.pubgUserService.getUserByNickname(nickname);

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const task = await this.taskService.getLatestTaskByUserId(user.id);

      if (!task) {
        return this.successResponse({ task: null }, 'No task found for this user');
      }

      return this.successResponse({ task });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error getting task status for nickname ${nickname}:`, error);
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ============================================================
  // 死亡笔记
  // ============================================================

  /**
   * 创建死亡笔记生成任务（仅初次生成）
   * POST /api/v1/pubg/tasks/death-note/generate/:nickname
   */
  @Post('death-note/generate/:nickname')
  async createDeathNoteGenerateTask(@Param('nickname') nickname: string): Promise<Record<string, any>> {
    validateNickname(nickname);

    const userInfo = await this.pubgUserService.getUserByNickname(nickname);

    if (await this.taskService.getRunningTask(userInfo.id)) {
      throw new HttpException('User already has a running task', HttpStatus.CONFLICT);
    }

    try {
      const generation = await this.pubgDeathNoteService.getDeathNoteGenerationStatus(userInfo.id);
      if (generation.isGenerated) {
        throw new HttpException('Death note already generated for this user, use incremental update instead', HttpStatus.CONFLICT);
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
    }

    const result: any = await (this.pubgDeathNoteService as any).requestDeathNoteGenerationByUserId(userInfo.id);

    return this.taskCreatedResponse(result.taskId, 'Death note generation task created');
  }

  /**
   * 创建死亡笔记增量更新任务
   * POST /api/v1/pubg/tasks/death-note/incremental/:nickname
   */
  @Post('death-note/incremental/:nickname')
  async createDeathNoteIncrementalTask(@Param('nickname') nickname: string): Promise<Record<string, any>> {
    validateNickname(nickname);

    const userInfo = await this.pubgUserService.getUserByNickname(nickname);

    if (await this.taskService.getRunningTask(userInfo.id)) {
      throw new HttpException('User already has a running task', HttpStatus.CONFLICT);
    }

    try {
      const generation = await this.pubgDeathNoteService.getDeathNoteGenerationStatus(userInfo.id);
      if (!generation.isGenerated) {
        throw new HttpException('Death note not yet generated, please generate first', HttpStatus.CONFLICT);
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
    }

    const result: any = await (this.pubgDeathNoteService as any).incrementalUpdate(userInfo.id);

    return this.taskCreatedResponse(result.taskId, 'Death note incremental update task created');
  }

  /**
   * 创建死亡笔记强制生成任务
   * 如果用户有正在运行的任务，先终止再开始
   * POST /api/v1/pubg/tasks/death-note/force-generate/:nickname
   */
  @Post('death-note/force-generate/:nickname')
  async createDeathNoteForceGenerateTask(@Param('nickname') nickname: string): Promise<Record<string, any>> {
    validateNickname(nickname);

    const userInfo = await this.pubgUserService.getUserByNickname(nickname);

    const result: any = await (this.pubgDeathNoteService as any).forceGenerateDeathNote(userInfo.id);

    return this.taskCreatedResponse(result.taskId, 'Death note force generation task created');
  }

  /**
   * 获取所有死亡笔记列表
   * GET /api/v1/pubg/tasks/death-note/list
   */
  @Get('death-note/list')
  async getDeathNoteList(): Promise<Record<string, any>> {
    const deathNotes = await this.pubgDeathNoteService.getAllDeathNotes();
    return this.successResponse({ data: deathNotes, total: deathNotes.length });
  }

  // ============================================================
  // 本地数据同步
  // ============================================================

  /**
   * 创建本地比赛数据同步任务
   * 读取本地 game-data，同步 match、userMatch、killEvent 到数据库
   * POST /api/v1/pubg/tasks/sync-local-matches
   */
  @Post('sync-local-matches')
  async createSyncLocalMatchesTask(): Promise<Record<string, any>> {
    const result: any = await (this.pubgMatchService as any).syncLocalMatches();

    return this.taskCreatedResponse(result.taskId, 'Local match sync task created');
  }
}
