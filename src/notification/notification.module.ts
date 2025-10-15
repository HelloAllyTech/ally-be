import { Module } from '@nestjs/common';
import { NotificationService } from './service/notification.service';
import { NotificationEventConsumer } from './event/notification.event.consumer';
import { SlackService } from './service/slack.service';
import { ProviderFactory } from '../factory/provider.factory';
import { Msg91Service } from './service/msg91.service';
import { EmailService } from './service/email.service';
import { AwsModule } from '../aws/aws.module';
@Module({
  imports: [AwsModule],
  providers: [
    NotificationService,
    NotificationEventConsumer,
    SlackService,
    Msg91Service,
    EmailService,
    ProviderFactory.getSMSFactory(),
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
