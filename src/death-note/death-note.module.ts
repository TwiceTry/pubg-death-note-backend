import { Module } from '@nestjs/common';
import { DeathNoteController } from './death-note.controller';
import { DeathNoteService } from './death-note.service';
import { PubgModule } from '../pubg/pubg.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TaskModule } from '../task/task.module';

@Module({
  imports: [
    PrismaModule,
    PubgModule,
    TaskModule,
  ],
  controllers: [DeathNoteController],
  providers: [DeathNoteService],
  exports: [DeathNoteService],
})
export class DeathNoteModule {}
