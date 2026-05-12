import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PubgUserService } from './pubg-user.service';

export interface DeathNoteStatusResult {
  isGenerated: boolean;
  createdAt: Date;
  latestTaskStatus: string | null;
  latestTaskProgress: number;
  latestTaskType: string | null;
}

export interface DeathNoteOverview {
  userId: string;
  nickname: string;
  isGenerated: boolean;
  createdAt: Date;
  dailyIncrementalEnabled: boolean;
  latestTaskStatus: string | null;
  latestTaskProgress: number;
  latestTaskType: string | null;
  firstRequestTime: Date;
  lastUpdateTime: Date | null;
}

@Injectable()
export class DeathNoteGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: PubgUserService,
  ) {}

  async findByUserId(userId: string) {
    return this.prisma.deathNoteGeneration.findUnique({
      where: { userId },
    });
  }

  async findAll() {
    return this.prisma.deathNoteGeneration.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(userId: string, data: { isGenerated?: boolean; dailyIncrementalEnabled?: boolean }) {
    return this.prisma.deathNoteGeneration.create({
      data: {
        userId,
        isGenerated: data.isGenerated ?? false,
        dailyIncrementalEnabled: data.dailyIncrementalEnabled ?? true,
      },
    });
  }

  async updateIsGenerated(userId: string, isGenerated: boolean) {
    return this.prisma.deathNoteGeneration.update({
      where: { userId },
      data: { isGenerated },
    });
  }

  async reset(userId: string) {
    return this.prisma.deathNoteGeneration.update({
      where: { userId },
      data: { isGenerated: false },
    });
  }

  async deleteByUserId(userId: string) {
    return this.prisma.deathNoteGeneration.deleteMany({
      where: { userId },
    });
  }

  async exists(userId: string): Promise<boolean> {
    const generation = await this.findByUserId(userId);
    return !!generation;
  }

  async isGenerated(userId: string): Promise<boolean> {
    const generation = await this.findByUserId(userId);
    return generation?.isGenerated ?? false;
  }

  /**
   * 获取死亡笔记生成状态
   */
  async getGenerationStatus(userId: string): Promise<DeathNoteStatusResult> {
    const generation = await this.findByUserId(userId);

    if (!generation) {
      throw new Error(`No death note generation record found for user ${userId}`);
    }

    const latestTask = await this.prisma.task.findFirst({
      where: { userId, type: { contains: 'death_note' } },
      orderBy: { createdAt: 'desc' },
      select: { status: true, progress: true, type: true },
    });

    return {
      isGenerated: generation.isGenerated,
      createdAt: generation.createdAt,
      latestTaskStatus: latestTask?.status ?? null,
      latestTaskProgress: latestTask?.progress ?? 0,
      latestTaskType: latestTask?.type ?? null,
    };
  }

  /**
   * 获取所有死亡笔记概览
   */
  async getAllOverviews(): Promise<DeathNoteOverview[]> {
    const generations = await this.findAll();
    const results: DeathNoteOverview[] = [];

    for (const gen of generations) {
      const [user, firstTask, latestTask] = await Promise.all([
        this.userService.getUserById(gen.userId),
        this.prisma.task.findFirst({
          where: { userId: gen.userId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.task.findFirst({
          where: { userId: gen.userId },
          orderBy: { createdAt: 'desc' },
          select: { status: true, progress: true, type: true, completedAt: true },
        }),
      ]);

      results.push({
        userId: gen.userId,
        nickname: user.name,
        isGenerated: gen.isGenerated,
        createdAt: gen.createdAt,
        dailyIncrementalEnabled: gen.dailyIncrementalEnabled,
        latestTaskStatus: latestTask?.status ?? null,
        latestTaskProgress: latestTask?.progress ?? 0,
        latestTaskType: latestTask?.type ?? null,
        firstRequestTime: firstTask?.createdAt ?? gen.createdAt,
        lastUpdateTime: latestTask?.completedAt ?? null,
      });
    }

    return results;
  }
}
