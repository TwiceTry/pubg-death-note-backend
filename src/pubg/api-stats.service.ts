// src/pubg/api-stats.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiStatsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ============================================================
  // 公开 API - 请求统计
  // ============================================================

  /**
   * 记录 API 请求统计
   * 
   * 功能说明：
   * - 使用 upsert 保证端点统计唯一性
   * - 自动计算平均响应时间
   * - 更新成功/失败/限流计数
   * 
   * @param endpoint - 端点类型
   * @param responseTime - 响应时间（毫秒）
   * @param success - 是否成功
   * @param rateLimited - 是否被限流
   */
  async recordRequest(
    endpoint: string,
    responseTime: number,
    success: boolean,
    rateLimited = false,
  ): Promise<void> {
    const stats = await this.prisma.apiStats.upsert({
      where: { endpoint },
      create: {
        endpoint,
        totalRequests: 1,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        rateLimitCount: rateLimited ? 1 : 0,
        totalResponseTime: responseTime,
        avgResponseTime: responseTime,
        lastRequestAt: new Date(),
      },
      update: {
        totalRequests: { increment: 1 },
        successCount: success ? { increment: 1 } : undefined,
        failureCount: success ? undefined : { increment: 1 },
        rateLimitCount: rateLimited ? { increment: 1 } : undefined,
        totalResponseTime: { increment: responseTime },
        lastRequestAt: new Date(),
      },
    });

    await this.prisma.apiStats.update({
      where: { endpoint },
      data: {
        avgResponseTime: stats.totalResponseTime / stats.totalRequests,
      },
    });
  }

  // ============================================================
  // 公开 API - 统计查询
  // ============================================================

  /**
   * 获取 API 统计信息
   * 
   * 功能说明：
   * - 指定端点时返回单个端点统计
   * - 未指定时返回所有端点统计（按请求量降序）
   * 
   * @param endpoint - 端点类型（可选）
   * @returns 统计信息
   */
  async getStats(endpoint?: string) {
    if (endpoint) {
      return this.prisma.apiStats.findUnique({
        where: { endpoint },
      });
    }
    return this.prisma.apiStats.findMany({
      orderBy: { totalRequests: 'desc' },
    });
  }

  // ============================================================
  // 公开 API - 统计管理
  // ============================================================

  /**
   * 重置指定端点的统计
   * 
   * @param endpoint - 端点类型
   */
  async resetStats(endpoint: string): Promise<void> {
    await this.prisma.apiStats.delete({
      where: { endpoint },
    });
  }

  /**
   * 清空所有统计
   */
  async resetAllStats(): Promise<void> {
    await this.prisma.apiStats.deleteMany({});
  }
}
