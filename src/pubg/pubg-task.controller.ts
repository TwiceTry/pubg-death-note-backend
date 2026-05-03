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
} from '@nestjs/common';
import { PubgMatchService } from './pubg-match.service';
import { PubgDeathNoteService } from './pubg-death-note.service';
import { PubgUserService } from './pubg-user.service';
import { TaskService } from '../task/task.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { USER_ID_PREFIX, NICKNAME_MIN_LENGTH, NICKNAME_MAX_LENGTH, MATCH_ID_MIN_LENGTH } from './pubg.constants';

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
  private successResponse(data: Record<string, any>, message?: string) {
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
  private taskCreatedResponse(taskId: string, message: string = 'Task created successfully') {
    this.logger.log(`Created task: ${taskId}`);
    return {
      success: true,
      message,
      taskId,
      statusUrl: `/api/v1/pubg/tasks/${taskId}`,
    };
  }

  /**
   * 创建用户比赛重解析任务
   * POST /api/v1/pubg/tasks/reparse/user/:userId
   */
  @Post('reparse/user/:userId')
  async createUserReparseTask(@Param('userId') userId: string) {
    if (!userId || !userId.startsWith(USER_ID_PREFIX)) {
      throw new HttpException('Invalid user ID', HttpStatus.BAD_REQUEST);
    }

    if (await this.taskService.hasRunningTask(userId)) {
      throw new HttpException('User already has a running task', HttpStatus.CONFLICT);
    }

    const taskId = await this.taskService.createAndExecuteTask(
      'reparse_user',
      async () => {
        const result = await this.pubgMatchService.reparseUserTelemetryWithProgress(
          userId,
          async (current, total, percentage) => {
            await this.taskService.updateTaskStatus(taskId, 'running', percentage);
          },
          async () => this.taskService.isTaskCancelled(taskId),
        );
        return { ...result, userId };
      },
      userId,
    );

    return this.taskCreatedResponse(taskId, 'User match reparse task created');
  }

  /**
   * 创建全局比赛重解析任务
   * POST /api/v1/pubg/tasks/reparse/all
   */
  @Post('reparse/all')
  async createGlobalReparseTask() {
    const taskId = await this.taskService.createAndExecuteTask(
      'reparse_all',
      async () => {
        const result = await this.pubgMatchService.reparseAllTelemetryWithProgress(
          async (current, total, percentage) => {
            await this.taskService.updateTaskStatus(taskId, 'running', percentage);
          },
        );
        return result;
      },
    );

    return this.taskCreatedResponse(taskId, 'Global match reparse task created');
  }

  /**
   * 获取全局最新任务状态
   * GET /api/v1/pubg/tasks/latest
   */
  @Get('latest')
  async getLatestTask() {
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
  async getAllTasks(@Query('page') page?: string, @Query('limit') limit?: string) {
    const result = await this.taskService.getAllTasks(Number(page) || 1, Number(limit) || 20);
    return this.successResponse(result);
  }

  /**
   * 获取指定任务状态
   * GET /api/v1/pubg/tasks/:taskId
   */
  @Get(':taskId')
  async getTask(@Param('taskId') taskId: string) {
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
  async getUserTasks(@Param('userId') userId: string) {
    if (!userId || !userId.startsWith(USER_ID_PREFIX)) {
      throw new HttpException('Invalid user ID', HttpStatus.BAD_REQUEST);
    }

    const tasks = await this.taskService.getTasksByUserId(userId);

    return this.successResponse({ tasks });
  }

  /**
   * 获取用户最新任务状态
   * GET /api/v1/pubg/tasks/user/:userId/latest
   */
  @Get('user/:userId/latest')
  async getUserLatestTask(@Param('userId') userId: string) {
    if (!userId || !userId.startsWith(USER_ID_PREFIX)) {
      throw new HttpException('Invalid user ID', HttpStatus.BAD_REQUEST);
    }

    const task = await this.taskService.getLatestTaskByUserId(userId);

    if (!task) {
      return this.successResponse({ task: null }, 'No task found for this user');
    }

    return this.successResponse({ task });
  }

  /**
   * 创建死亡笔记生成任务
   * POST /api/v1/pubg/tasks/death-note/generate/:nickname
   */
  @Post('death-note/generate/:nickname')
  async createDeathNoteGenerateTask(@Param('nickname') nickname: string) {
    if (!nickname || nickname.length < NICKNAME_MIN_LENGTH || nickname.length > NICKNAME_MAX_LENGTH) {
      throw new HttpException('Invalid nickname', HttpStatus.BAD_REQUEST);
    }

    const userInfo = await this.pubgUserService.getUserByNickname(nickname);

    if (await this.taskService.hasRunningTask(userInfo.id)) {
      throw new HttpException('User already has a running task', HttpStatus.CONFLICT);
    }

    const taskId = await this.taskService.createAndExecuteTask(
      'death_note_generate',
      async (taskId: string) => {
        let isIncremental = false;
        try {
          const generation = await this.pubgDeathNoteService.getDeathNoteGenerationStatus(userInfo.id);
          isIncremental = generation.isGenerated;
        } catch {
          isIncremental = false;
        }

        const result = await this.pubgDeathNoteService.requestDeathNoteGenerationByUserId(userInfo.id, taskId);
        
        return {
          success: true,
          message: isIncremental ? 'Death note incremental update completed' : 'Death note generation completed',
          isIncremental,
          ...result,
          userId: userInfo.id,
          nickname: userInfo.name,
        };
      },
      userInfo.id,
    );

    return this.taskCreatedResponse(taskId, 'Death note generation task created');
  }

  /**
   * 创建死亡笔记强制生成任务
   * 如果用户有正在运行的任务，先终止再开始
   * POST /api/v1/pubg/tasks/death-note/force-generate/:nickname
   */
  @Post('death-note/force-generate/:nickname')
  async createDeathNoteForceGenerateTask(@Param('nickname') nickname: string) {
    if (!nickname || nickname.length < NICKNAME_MIN_LENGTH || nickname.length > NICKNAME_MAX_LENGTH) {
      throw new HttpException('Invalid nickname', HttpStatus.BAD_REQUEST);
    }

    const userInfo = await this.pubgUserService.getUserByNickname(nickname);

    if (await this.taskService.hasRunningTask(userInfo.id)) {
      const cancelled = await this.taskService.cancelRunningTasks(userInfo.id);
      this.logger.log(`Cancelled ${cancelled} running task(s) for user ${userInfo.id} before force generation`);
    }

    const taskId = await this.taskService.createAndExecuteTask(
      'death_note_force_generate',
      async (taskId: string) => {
        const result = await this.pubgDeathNoteService.forceGenerateDeathNote(userInfo.id, taskId);
        return {
          success: true,
          message: 'Force death note generation completed',
          ...result,
          userId: userInfo.id,
          nickname: userInfo.name,
        };
      },
      userInfo.id,
    );

    return this.taskCreatedResponse(taskId, 'Death note force generation task created');
  }

  /**
   * 创建本地比赛数据同步任务
   * 读取本地 game-data，同步 match、userMatch、killEvent 到数据库
   * POST /api/v1/pubg/tasks/sync-local-matches
   */
  @Post('sync-local-matches')
  async createSyncLocalMatchesTask() {
    const taskId = await this.taskService.createAndExecuteTask(
      'sync_local_matches',
      async (taskId: string) => {
        const result = await this.pubgMatchService.syncLocalMatches(
          async (current, total, percentage) => {
            await this.taskService.updateTaskStatus(taskId, 'running', percentage);
          },
          async () => this.taskService.isTaskCancelled(taskId),
        );
        return result;
      },
    );

    return this.taskCreatedResponse(taskId, 'Local match sync task created');
  }

  /**
   * 重新解析单个比赛的遥测数据
   * POST /api/v1/pubg/tasks/telemetry/reparse/match/:matchId
   */
  @Post('telemetry/reparse/match/:matchId')
  async reparseMatchTelemetry(@Param('matchId') matchId: string) {
    if (!matchId || matchId.length < MATCH_ID_MIN_LENGTH) {
      throw new BadRequestException('Invalid match ID');
    }

    const taskId = await this.taskService.createAndExecuteTask(
      'reparse_match',
      async (taskId: string) => {
        const result = await this.pubgMatchService.reparseMatchTelemetry(matchId, taskId);
        return { ...result, matchId };
      },
    );

    return this.taskCreatedResponse(taskId, 'Reparse task created');
  }

  /**
   * 通过用户昵称获取最新任务状态
   * GET /api/v1/pubg/tasks/users/nickname/:nickname/task-status
   */
  @Get('users/nickname/:nickname/task-status')
  async getLatestTaskByNickname(@Param('nickname') nickname: string) {
    if (!nickname || nickname.length < NICKNAME_MIN_LENGTH || nickname.length > NICKNAME_MAX_LENGTH) {
      throw new HttpException('Invalid nickname', HttpStatus.BAD_REQUEST);
    }

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
}