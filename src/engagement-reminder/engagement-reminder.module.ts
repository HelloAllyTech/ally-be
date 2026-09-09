import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/notification/notification.module';
import { EngagementReminderEvaluatorService } from './service/engagement-reminder-evaluator.service';
import { EngagementReminderSchedulerRegistrationService } from './service/engagement-reminder-scheduler-registration.service';

@Module({
  imports: [NotificationModule],
  providers: [
    EngagementReminderEvaluatorService,
    EngagementReminderSchedulerRegistrationService,
  ],
})
export class EngagementReminderModule {}
