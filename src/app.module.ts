import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { DeathNoteModule } from './death-note/death-note.module';
import { PubgModule } from './pubg/pubg.module';
import { LoggerModule } from './common/logger.module';
import { ScheduledTaskModule } from './scheduled-task/scheduled-task.module';

@Module({
  imports: [
    // 注册 ConfigModule 并启用 Joi 校验
    ConfigModule.forRoot({
      isGlobal: true, // 全局可用，无需在每个 Module 导入
      validationSchema: envSchema, // 挂载 Joi Schema
      validationOptions: {
        allowUnknown: true, // 允许 .env 中存在 Schema 未定义的变量
        abortEarly: true, // 遇到第一个错误就停止
      },
    }),
    // 2. 数据库模块 (Global)
    PrismaModule,
    // 3. 日志模块 (Global)
    LoggerModule,
    DeathNoteModule,
    PubgModule,
    ScheduledTaskModule,
  ],
})
export class AppModule {}
