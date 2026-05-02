import { Module } from '@nestjs/common';
import { ScheduledTaskService } from './scheduled-task.service';
import { PubgModule } from '../pubg/pubg.module';
import { TaskModule } from '../task/task.module';

@Module({
  imports: [PubgModule, TaskModule],
  providers: [ScheduledTaskService],
  exports: [ScheduledTaskService],
})
export class ScheduledTaskModule {}
