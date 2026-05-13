// src/death-note/death-note.module.ts
// 死亡笔记模块
// 负责死亡笔记查询相关功能，包括击杀历史、分页查询、狙击查询等

import { Module } from '@nestjs/common';
import { DeathNoteController } from './death-note.controller';
import { DeathNoteService } from './death-note.service';
import { PubgModule } from '../pubg/pubg.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TaskModule } from '../task/task.module';
import { GameDataI18nModule } from '../game-data-i18n/game-data-i18n.module';

@Module({
  imports: [
    PrismaModule,
    PubgModule,
    TaskModule,
    GameDataI18nModule,
  ],
  controllers: [DeathNoteController],
  providers: [DeathNoteService],
  exports: [DeathNoteService],
})
export class DeathNoteModule {}
