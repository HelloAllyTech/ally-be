import { Module } from '@nestjs/common';
import { NotificationService } from './service/notification.service';
import { NotificationEventConsumer } from './event/notification.event.consumer';
import { SlackService } from './service/slack.service';
@Module({
  imports: [],
  providers: [NotificationService, NotificationEventConsumer, SlackService],
})
export class NotificationModule {}
