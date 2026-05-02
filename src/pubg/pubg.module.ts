import { Module } from '@nestjs/common';
import { PubgApiService } from './pubg-api.service';
import { PubgUserService } from './pubg-user.service';
import { PubgSeasonService } from './pubg-season.service';
import { PubgMatchService } from './pubg-match.service';
import { PubgDeathNoteService } from './pubg-death-note.service';
import { PubgMatchController } from './pubg-match.controller';
import { PubgTaskController } from './pubg-task.controller';
import { TaskModule } from '../task/task.module';

@Module({
  imports: [TaskModule],
  controllers: [PubgMatchController, PubgTaskController],
  providers: [
    PubgApiService,
    PubgUserService,
    PubgSeasonService,
    PubgMatchService,
    PubgDeathNoteService,
  ],
  exports: [
    PubgApiService,
    PubgUserService,
    PubgSeasonService,
    PubgMatchService,
    PubgDeathNoteService,
  ],
})
export class PubgModule {}
