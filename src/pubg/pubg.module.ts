import { Module } from '@nestjs/common';
import { PubgApiService } from './pubg-api.service';
import { PubgUserService } from './pubg-user.service';
import { PubgSeasonService } from './pubg-season.service';
import { PubgMatchService } from './pubg-match.service';
import { PubgDeathNoteService } from './pubg-death-note.service';
import { DeathNoteProgressService } from './pubg-death-note-progress.service';
import { DeathNoteGenerationService } from './death-note-generation.service';
import { UserMatchService } from './user-match.service';
import { KillEventService } from './kill-event.service';
import { ApiStatsService } from './api-stats.service';
import { ApiRequestDetailService } from './api-request-detail.service';
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
    DeathNoteProgressService,
    DeathNoteGenerationService,
    UserMatchService,
    KillEventService,
    ApiStatsService,
    ApiRequestDetailService,
  ],
  exports: [
    PubgApiService,
    PubgUserService,
    PubgSeasonService,
    PubgMatchService,
    PubgDeathNoteService,
    DeathNoteProgressService,
    DeathNoteGenerationService,
    UserMatchService,
    KillEventService,
    ApiStatsService,
    ApiRequestDetailService,
  ],
})
export class PubgModule {}
