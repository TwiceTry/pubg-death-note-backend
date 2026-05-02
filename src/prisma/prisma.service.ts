import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  get user() {
    return this.prisma.user;
  }

  get match() {
    return this.prisma.match;
  }

  get killEvent() {
    return this.prisma.killEvent;
  }

  get apiRequestLog() {
    return this.prisma.apiRequestLog;
  }

  get season() {
    return this.prisma.season;
  }

  get userMatch() {
    return this.prisma.userMatch;
  }

  get deathNoteGeneration() {
    return this.prisma.deathNoteGeneration;
  }

  get task() {
    return this.prisma.task;
  }

  get deathNoteProgress() {
    return this.prisma.deathNoteProgress;
  }

  get scheduledTaskConfig() {
    return this.prisma.scheduledTaskConfig;
  }

  get $transaction() {
    return this.prisma.$transaction.bind(this.prisma);
  }
}
