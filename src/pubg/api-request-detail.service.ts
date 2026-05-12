import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiRequestDetailService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

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

  async getRecentRequests(limit: number = 50) {
    return this.prisma.apiRequestDetail.findMany({
      take: limit,
      orderBy: { requestTime: 'desc' },
    });
  }

  async getRequestsByEndpoint(endpoint: string, limit: number = 50) {
    return this.prisma.apiRequestDetail.findMany({
      where: { endpoint },
      take: limit,
      orderBy: { requestTime: 'desc' },
    });
  }

  async getFailedRequests(limit: number = 50) {
    return this.prisma.apiRequestDetail.findMany({
      where: { success: false },
      take: limit,
      orderBy: { requestTime: 'desc' },
    });
  }

  async clearOldRequests(daysToKeep: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    await this.prisma.apiRequestDetail.deleteMany({
      where: {
        requestTime: { lt: cutoffDate },
      },
    });
  }

  async clearAllRequests(): Promise<void> {
    await this.prisma.apiRequestDetail.deleteMany({});
  }
}
