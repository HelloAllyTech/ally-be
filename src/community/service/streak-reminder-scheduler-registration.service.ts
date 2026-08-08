import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { StreakReminderService } from './streak-reminder.service';

@Injectable()
export class StreakReminderSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly streakReminderService: StreakReminderService) {}

  onModuleInit(): void {
    // Registered hourly, but the handler itself only proceeds during the
    // reminder hour in the business timezone. Doing the gating inside the
    // handler rather than with a cron expression keeps it correct regardless of
    // the container's timezone, which is not set anywhere in this repo.
    scheduledTaskRegistry.register('hourly', 'streak-at-risk-reminder', () =>
      this.streakReminderService.sendAtRiskReminders(),
    );
  }
}
