import { Module } from '@nestjs/common';
import { NotificationService } from './service/notification.service';
import { NotificationEventConsumer } from './event/notification.event.consumer';
import { SlackService } from './service/slack.service';
import { ProviderFactory } from '../factory/provider.factory';
import { Msg91Service } from './service/msg91.service';
import { SESService } from './service/ses.service';
@Module({
  imports: [],
  providers: [
    NotificationService,
    NotificationEventConsumer,
    SlackService,
    Msg91Service,
    SESService,
    ProviderFactory.getSMSFactory(),
    ProviderFactory.getEmailFactory(),
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
