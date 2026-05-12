import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiStatsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async recordRequest(
    endpoint: string,
    responseTime: number,
    success: boolean,
    rateLimited: boolean = false,
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

  async resetStats(endpoint: string): Promise<void> {
    await this.prisma.apiStats.delete({
      where: { endpoint },
    });
  }

  async resetAllStats(): Promise<void> {
    await this.prisma.apiStats.deleteMany({});
  }
}
