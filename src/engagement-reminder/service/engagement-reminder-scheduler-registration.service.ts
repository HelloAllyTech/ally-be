import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { EngagementReminderEvaluatorService } from './engagement-reminder-evaluator.service';

@Injectable()
export class EngagementReminderSchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly evaluatorService: EngagementReminderEvaluatorService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('hourly', 'engagement-reminder', () =>
      this.evaluatorService.evaluate(),
    );
  }
}
