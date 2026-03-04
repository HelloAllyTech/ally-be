import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduledTaskRunnerService } from './service/scheduled-task-runner.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ScheduledTaskRunnerService],
  exports: [],
})
export class SchedulerModule {}
