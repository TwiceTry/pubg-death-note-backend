// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // 标记为全局模块，这样在其他 Module 中使用 PrismaService 时，不需要重复导入 PrismaModule
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // 导出 Service 供外部使用
})
export class PrismaModule {}
