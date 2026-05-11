/**
 * @module TaskDecorator
 * @description 任务执行装饰器，统一任务生命周期管理
 *
 * 核心功能：
 * - 自动创建任务记录并管理状态
 * - 提供任务上下文（进度更新、取消检查）
 * - 支持 AbortController 实现任务取消
 * - 通过 AsyncLocalStorage 使上下文全局可访问
 *
 * 使用示例：
 * ```typescript
 * @ExecutableTask({
 *   type: 'my_task',
 *   getUserId: (args) => args[0],
 *   buildResult: (result) => ({ success: true, data: result }),
 * })
 * async myTask(userId: string) {
 *   const ctx = getCurrentTaskContext();
 *   ctx?.updateProgress(50);
 *   ctx?.checkCancelled();
 *   return { data: 'done' };
 * }
 * ```
 */
import { AsyncLocalStorage } from 'async_hooks';
import { TaskService, TaskResult } from './task.service';

// ============================================================
// 类型定义
// ============================================================

/**
 * 任务执行上下文
 * 在 @ExecutableTask 装饰的方法及其所有下游调用中可用
 */
export interface TaskContext {
  /** 任务唯一标识 */
  taskId: string;

  /**
   * 更新任务进度
   * @param progress 进度百分比，范围 0-100
   */
  updateProgress: (progress: number) => Promise<void>;

  /**
   * AbortSignal 实例
   * 可传递给 fetch、setTimeout 等原生 API 实现自动取消
   */
  signal: AbortSignal;

  /**
   * 检查任务是否被取消
   * 若已取消则抛出 AbortError 异常中断执行
   * 建议在循环或耗时操作前调用
   */
  checkCancelled: () => void;
}

/**
 * 装饰器配置选项
 */
export interface TaskDecoratorOptions {
  /** 任务类型标识，用于区分不同任务 */
  type: string;

  /**
   * 从方法参数中提取 userId 的函数
   * 用于关联用户与任务
   * @param args 方法调用时的参数数组
   * @returns userId 或 undefined
   */
  getUserId?: (args: unknown[]) => string | undefined;

  /**
   * 是否检查用户是否有运行中的任务
   * 若为 true 且存在运行中任务则抛出异常
   * @default false
   */
  checkRunningTask?: boolean;

  /**
   * 是否强制取消用户运行中的任务并继续
   * 若为 true 则自动取消已有任务
   * @default false
   */
  forceCancelRunningTask?: boolean;

  /**
   * 是否异步执行
   * - true: 立即返回 { taskId }，任务在后台执行
   * - false: 等待任务完成并返回结果
   * @default false
   */
  async?: boolean;

  /**
   * 自定义任务成功结果构建函数
   * @param result 方法返回值
   * @param args 方法调用时的原始参数
   * @returns 任务结果对象
   */
  buildResult?: (result: unknown, args: unknown[]) => TaskResult;
}

// ============================================================
// 全局上下文存储
// ============================================================

/**
 * AsyncLocalStorage 实例
 * 用于在异步调用链中传递 TaskContext
 * 所有下游代码可通过 getCurrentTaskContext() 获取当前任务上下文
 */
const taskContextStorage = new AsyncLocalStorage<TaskContext>();

/**
 * 轮询间隔（毫秒）
 * 用于检测任务是否被取消
 */
const CANCEL_POLL_INTERVAL_MS = 1000;

/**
 * 判断是否为任务取消错误
 * 用于业务代码中区分"任务被取消"和"普通业务错误"
 */
export function isTaskCancelled(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
}

/**
 * 获取当前任务的上下文
 * 仅在 @ExecutableTask 装饰的方法调用链中有效
 * @returns 当前任务上下文，若无则返回 undefined
 */
export function getCurrentTaskContext(): TaskContext | undefined {
  return taskContextStorage.getStore();
}

// ============================================================
// 装饰器实现
// ============================================================

/**
 * 任务执行装饰器
 *
 * 包装方法以自动管理任务生命周期：
 * 1. 创建任务记录
 * 2. 启动取消状态轮询
 * 3. 注入 TaskContext 到方法参数
 * 4. 执行方法并更新任务状态
 * 5. 清理轮询定时器
 *
 * @param options 装饰器配置
 * @returns 方法装饰器
 */
export function ExecutableTask(options: TaskDecoratorOptions) {
  return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor): void {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const taskService = this.taskService as TaskService | undefined;

      if (!taskService) {
        throw new Error('ExecutableTask requires taskService property on the class');
      }

      const userId = options.getUserId?.(args);

      // 检查运行中任务
      if (options.checkRunningTask && userId) {
        const runningTask = await taskService.getRunningTask(userId);
        if (runningTask) {
          throw new Error('User already has a running task');
        }
      }

      // 强制取消运行中任务
      if (options.forceCancelRunningTask && userId) {
        const cancelledCount = await taskService.cancelRunningTasks(userId);
        if (cancelledCount > 0) {
          this.logger?.log?.(`Cancelled ${cancelledCount} running task(s) for user ${userId}`);
        }
      }

      // 创建任务
      const taskId = await taskService.createTask(options.type, userId);
      const abortController = new AbortController();

      // 后台轮询取消状态，自动触发 abort
      const cancelInterval = setInterval(async () => {
        const isCancelled = await taskService.isTaskCancelled(taskId);
        if (isCancelled) {
          abortController.abort('Task was cancelled');
          clearInterval(cancelInterval);
        }
      }, CANCEL_POLL_INTERVAL_MS);

      // 构建任务上下文
      const context: TaskContext = {
        taskId,
        updateProgress: async (progress: number) => {
          await taskService.setTaskRunning(taskId, progress);
        },
        signal: abortController.signal,
        checkCancelled: () => {
          if (abortController.signal.aborted) {
            throw new DOMException('Task was cancelled', 'AbortError');
          }
        },
      };

      // 使用 taskService.executeTask 统一执行流程
      const taskFn = async (currentTaskId: string): Promise<TaskResult> => {
        // 在 AsyncLocalStorage 中执行，使所有下游代码可访问当前任务上下文
        return await taskContextStorage.run(context, async () => {
          const result = await originalMethod.call(this, ...args);

          // 构建任务结果
          return options.buildResult
            ? options.buildResult(result, args)
            : {
                success: true,
                message: (result as Record<string, unknown>)?.message as string | undefined || 'Task completed successfully',
                ...(result as Record<string, unknown>),
              };
        });
      };

      // 异步执行：立即返回 taskId
      if (options.async) {
        taskService.executeTask(taskId, taskFn).finally(() => clearInterval(cancelInterval));
        return { taskId };
      }

      // 同步执行：等待任务完成并返回结果
      const taskResult = await taskFn(taskId);
      await taskService.setTaskResult(taskId, taskResult);
      clearInterval(cancelInterval);
      return { taskId, ...taskResult };
    };
  };
}
