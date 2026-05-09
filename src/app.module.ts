import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { DeathNoteModule } from './death-note/death-note.module';
import { PubgModule } from './pubg/pubg.module';
import { LoggerModule } from './common/logger.module';
import { ScheduledTaskModule } from './scheduled-task/scheduled-task.module';
import { TaskModule } from './task/task.module';
import { AppBootstrapService } from './common/app-bootstrap.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),
    PrismaModule,
    LoggerModule,
    TaskModule,
    DeathNoteModule,
    PubgModule,
    ScheduledTaskModule,
  ],
  providers: [AppBootstrapService],
})
export class AppModule {}
