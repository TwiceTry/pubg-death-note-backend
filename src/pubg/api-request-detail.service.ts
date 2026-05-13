// src/pubg/api-request-detail.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiRequestDetailService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ============================================================
  // 公开 API - 请求记录
  // ============================================================

  /**
   * 记录 API 请求详情
   * 
   * 功能说明：
   * - 记录每次 API 请求的详细信息
   * - 包含 URL、方法、Token、响应时间、成功状态等
   * 
   * @param url - 请求 URL
   * @param method - 请求方法
   * @param tokenUsed - 使用的 Token（脱敏后）
   * @param responseTime - 响应时间（毫秒）
   * @param success - 是否成功
   * @param endpoint - 端点类型
   * @param error - 错误信息（可选）
   * @param responseData - 响应数据（可选，截断后）
   */
  async recordRequest(
    url: string,
    method: string,
    tokenUsed: string,
    responseTime: number,
    success: boolean,
    endpoint: string,
    error?: string,
    responseData?: string,
  ): Promise<void> {
    await this.prisma.apiRequestDetail.create({
      data: {
        url,
        method,
        tokenUsed,
        responseTime,
        success,
        endpoint,
        error,
        responseData,
      },
    });
  }

  // ============================================================
  // 公开 API - 请求查询
  // ============================================================

  /**
   * 获取最近的请求记录
   * 
   * @param limit - 返回记录数量（默认 50）
   * @returns 请求记录列表，按时间倒序
   */
  async getRecentRequests(limit = 50) {
    return this.prisma.apiRequestDetail.findMany({
      take: limit,
      orderBy: { requestTime: 'desc' },
    });
  }

  /**
   * 按端点类型查询请求记录
   * 
   * @param endpoint - 端点类型
   * @param limit - 返回记录数量（默认 50）
   * @returns 请求记录列表，按时间倒序
   */
  async getRequestsByEndpoint(endpoint: string, limit = 50) {
    return this.prisma.apiRequestDetail.findMany({
      where: { endpoint },
      take: limit,
      orderBy: { requestTime: 'desc' },
    });
  }

  /**
   * 获取失败的请求记录
   * 
   * @param limit - 返回记录数量（默认 50）
   * @returns 失败的请求记录列表，按时间倒序
   */
  async getFailedRequests(limit = 50) {
    return this.prisma.apiRequestDetail.findMany({
      where: { success: false },
      take: limit,
      orderBy: { requestTime: 'desc' },
    });
  }

  // ============================================================
  // 公开 API - 数据清理
  // ============================================================

  /**
   * 清理过期的请求记录
   * 
   * 功能说明：
   * - 删除指定天数之前的记录
   * - 默认保留 30 天
   * 
   * @param daysToKeep - 保留天数（默认 30）
   */
  async clearOldRequests(daysToKeep = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    await this.prisma.apiRequestDetail.deleteMany({
      where: {
        requestTime: { lt: cutoffDate },
      },
    });
  }

  /**
   * 清空所有请求记录
   */
  async clearAllRequests(): Promise<void> {
    await this.prisma.apiRequestDetail.deleteMany({});
  }
}
