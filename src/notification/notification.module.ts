import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationService } from './service/notification.service';
import { NotificationEventConsumer } from './event/notification.event.consumer';
import { SlackService } from './service/slack.service';
import { EmailService } from './service/email.service';
import { AwsModule } from '../aws/aws.module';
import { InAppNotification } from './entity/in-app-notification.entity';
import { UserDeviceToken } from './entity/user-device-token.entity';
import { InAppNotificationService } from './service/in-app-notification.service';
import { DeviceTokenService } from './service/device-token.service';
import { PushService } from './service/push.service';
import { NotificationFeedController } from './controller/notification-feed.controller';
@Module({
  imports: [
    AwsModule,
    TypeOrmModule.forFeature([InAppNotification, UserDeviceToken]),
  ],
  controllers: [NotificationFeedController],
  providers: [
    NotificationService,
    NotificationEventConsumer,
    SlackService,
    EmailService,
    InAppNotificationService,
    DeviceTokenService,
    PushService,
  ],
  exports: [
    NotificationService,
    EmailService,
    SlackService,
    InAppNotificationService,
    DeviceTokenService,
    PushService,
  ],
})
export class NotificationModule {}
