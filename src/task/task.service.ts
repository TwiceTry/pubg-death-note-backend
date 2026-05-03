// src/task/task.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DualOutputLoggerService } from '../common/dual-output-logger.service';
import { TASK } from '../constants';

export interface TaskResult {
  success: boolean;
  message: string;
  [key: string]: any;
}

@Injectable()
export class TaskService {
  constructor(
    private prisma: PrismaService,
    private logger: DualOutputLoggerService,
  ) {}

  /**
   * 创建新任务
   * @param type 任务类型
   * @param userId 关联的用户ID（可选）
   * @returns 任务ID
   */
  async createTask(type: string, userId?: string): Promise<string> {
    const task = await this.prisma.task.create({
      data: {
        type,
        userId,
        status: 'pending',
        progress: 0,
      },
    });

    this.logger.log(`Created task ${task.id} with type ${type}${userId ? ` for user ${userId}` : ''}`);
    return task.id;
  }

  /**
   * 更新任务状态
   * @param taskId 任务ID
   * @param status 状态
   * @param progress 进度
   */
  async updateTaskStatus(
    taskId: string,
    status: string,
    progress?: number,
  ): Promise<void> {
    if (await this.isTaskCancelled(taskId)) return;

    const updateData: any = { status };
    if (progress !== undefined) {
      updateData.progress = progress;
    }

    if (status === 'running' && !updateData.startedAt) {
      updateData.startedAt = new Date();
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completedAt = new Date();
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });
  }

  /**
   * 更新任务心跳
   * @param taskId 任务ID
   * @param progress 进度（可选）
   */
  async updateHeartbeat(taskId: string, progress?: number): Promise<void> {
    if (await this.isTaskCancelled(taskId)) return;

    const updateData: any = { heartbeat: new Date() };
    if (progress !== undefined) {
      updateData.progress = progress;
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });
  }

  /**
   * 检查用户是否有正在运行的任务
   * @param userId 用户ID
   * @returns 是否有运行中的任务
   */
  async hasRunningTask(userId: string): Promise<boolean> {
    const count = await this.prisma.task.count({
      where: {
        userId,
        status: 'running',
      },
    });
    return count > 0;
  }

  /**
   * 获取全局正在运行的任务数量
   * @returns 运行中的任务数量
   */
  async getRunningTaskCount(): Promise<number> {
    return this.prisma.task.count({
      where: {
        status: 'running',
      },
    });
  }

  /**
   * 获取用户正在运行的任务
   * @param userId 用户ID
   * @returns 运行中的任务信息
   */
  async getRunningTask(userId: string) {
    const task = await this.prisma.task.findFirst({
      where: {
        userId,
        status: 'running',
      },
    });

    if (!task) {
      return null;
    }

    return {
      id: task.id,
      type: task.type,
      userId: task.userId,
      status: task.status,
      progress: task.progress,
      heartbeat: task.heartbeat,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * 取消用户所有正在运行的任务
   * @param userId 用户ID
   * @returns 取消的任务数量
   */
  async cancelRunningTasks(userId: string): Promise<number> {
    const result = await this.prisma.task.updateMany({
      where: {
        userId,
        status: 'running',
      },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });
    return result.count;
  }

  /**
   * 获取任务状态
   * @param taskId 任务ID
   * @returns 任务状态
   */
  private async getTaskStatus(taskId: string): Promise<string | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    return task?.status ?? null;
  }

  /**
   * 检查任务是否已被取消
   * @param taskId 任务ID
   * @returns 是否已取消
   */
  async isTaskCancelled(taskId: string): Promise<boolean> {
    return (await this.getTaskStatus(taskId)) === 'cancelled';
  }

  /**
   * 清理超时的运行任务
   * @param timeoutMs 超时时间（毫秒），默认 5 分钟
   * @returns 清理的任务数量
   */
  async cleanupStaleTasks(timeoutMs: number = TASK.STALE_TIMEOUT_MS): Promise<number> {
    const threshold = new Date(Date.now() - timeoutMs);

    const staleTasks = await this.prisma.task.findMany({
      where: {
        status: 'running',
        OR: [
          { heartbeat: { lt: threshold } },
          {
            AND: [
              { heartbeat: null },
              { startedAt: { lt: threshold } },
            ],
          },
        ],
      },
    });

    if (staleTasks.length > 0) {
      await this.prisma.task.updateMany({
        where: {
          id: { in: staleTasks.map(t => t.id) },
        },
        data: {
          status: 'failed',
          error: 'Task heartbeat timeout, possible crash',
          completedAt: new Date(),
        },
      });

      this.logger.log(`Cleaned up ${staleTasks.length} stale running tasks`);
    }

    return staleTasks.length;
  }

  /**
   * 设置任务结果
   * @param taskId 任务ID
   * @param result 结果数据
   */
  async setTaskResult(taskId: string, result: TaskResult): Promise<void> {
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        result: JSON.stringify(result),
        status: result.success ? 'completed' : 'failed',
        completedAt: new Date(),
      },
    });
  }

  /**
   * 设置任务错误
   * @param taskId 任务ID
   * @param error 错误信息
   */
  async setTaskError(taskId: string, error: string): Promise<void> {
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        error,
        status: 'failed',
        completedAt: new Date(),
      },
    });
  }

  /**
   * 获取任务状态
   * @param taskId 任务ID
   * @returns 任务信息
   */
  async getTask(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return null;
    }

    return {
      id: task.id,
      type: task.type,
      userId: task.userId,
      status: task.status,
      progress: task.progress,
      heartbeat: task.heartbeat,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * 获取所有任务列表（分页）
   * @param page 页码（从1开始）
   * @param limit 每页数量
   * @param types 任务类型筛选（可选）
   */
  async getAllTasks(page = 1, limit = 20, types?: string[]) {
    const where: any = {};

    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      tasks: tasks.map(task => ({
        id: task.id,
        type: task.type,
        userId: task.userId,
        status: task.status,
        progress: task.progress,
        heartbeat: task.heartbeat,
        result: task.result ? JSON.parse(task.result) : null,
        error: task.error,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 获取全局最新任务（不关联用户，用于 reparse_all 等全局任务）
   * @param types 任务类型筛选（可选）
   */
  async getLatestGlobalTask(types?: string[]) {
    const where: any = {};

    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const task = await this.prisma.task.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (!task) {
      return null;
    }

    return {
      id: task.id,
      type: task.type,
      userId: task.userId,
      status: task.status,
      progress: task.progress,
      heartbeat: task.heartbeat,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * 根据用户ID和任务类型获取最新任务
   * @param userId 用户ID
   * @param types 任务类型列表（可选）
   * @returns 最新任务信息
   */
  async getLatestTaskByUserId(userId: string, types?: string[]) {
    const where: any = { userId };
    
    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const task = await this.prisma.task.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (!task) {
      return null;
    }

    return {
      id: task.id,
      type: task.type,
      userId: task.userId,
      status: task.status,
      progress: task.progress,
      heartbeat: task.heartbeat,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * 根据用户ID获取任务列表
   * @param userId 用户ID
   * @param types 任务类型列表（可选）
   * @returns 任务列表
   */
  async getTasksByUserId(userId: string, types?: string[]) {
    const where: any = { userId };
    
    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return tasks.map(task => ({
      id: task.id,
      type: task.type,
      userId: task.userId,
      status: task.status,
      progress: task.progress,
      heartbeat: task.heartbeat,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }));
  }

  /**
   * 异步执行任务
   * @param taskId 任务ID
   * @param taskFn 任务执行函数
   */
  async executeTask(taskId: string, taskFn: (taskId: string) => Promise<TaskResult>): Promise<void> {
    try {
      await this.updateTaskStatus(taskId, 'running', 0);
      this.logger.log(`Task ${taskId} started`);

      const result = await taskFn(taskId);

      if (await this.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled, skipping result update`);
        return;
      }

      await this.setTaskResult(taskId, result);
      this.logger.log(`Task ${taskId} completed successfully`);
    } catch (error) {
      if (await this.isTaskCancelled(taskId)) {
        this.logger.log(`Task ${taskId} was cancelled, skipping error update`);
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.setTaskError(taskId, errorMessage);
      this.logger.error(`Task ${taskId} failed: ${errorMessage}`);
    }
  }

  async createAndExecuteTask(type: string, taskFn: (taskId: string) => Promise<TaskResult>, userId?: string): Promise<string> {
    const taskId = await this.createTask(type, userId);

    this.executeTask(taskId, taskFn).catch(error => {
      this.logger.error(`Error executing task ${taskId}:`, error);
    });

    return taskId;
  }
}