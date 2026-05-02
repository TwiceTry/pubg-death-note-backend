// src/pubg/pubg-match.controller.ts
import {
  Controller,
  Post,
  Get,
  Param,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PubgMatchService } from './pubg-match.service';
import { PubgUserService } from './pubg-user.service';
import { TaskService } from '../task/task.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { MATCH_ID_MIN_LENGTH, NICKNAME_MIN_LENGTH, NICKNAME_MAX_LENGTH } from './pubg.constants';

@Controller('pubg')
export class PubgMatchController {
  constructor(
    private readonly pubgMatchService: PubgMatchService,
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
   * 通过用户昵称获取最新任务状态
   * GET /api/v1/pubg/users/nickname/:nickname/task-status
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

  /**
   * 重新解析单个比赛的遥测数据
   * POST /api/v1/pubg/telemetry/reparse/match/:matchId
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
}
