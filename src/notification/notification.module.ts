import { Module } from '@nestjs/common';
import { NotificationService } from './service/notification.service';
import { NotificationEventConsumer } from './event/notification.event.consumer';
import { SlackService } from './service/slack.service';
import { EmailService } from './service/email.service';
import { AwsModule } from '../aws/aws.module';
@Module({
  imports: [AwsModule],
  providers: [
    NotificationService,
    NotificationEventConsumer,
    SlackService,
    EmailService,
  ],
  exports: [NotificationService, EmailService, SlackService],
})
export class NotificationModule {}
