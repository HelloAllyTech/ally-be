import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../service/notification.service';
import { NotificationErrorType } from '../type/notification.error.type';
@Injectable()
export class NotificationEventConsumer {
  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('exception')
  handleException(payload: NotificationErrorType) {
    this.notificationService.handleException(payload);
  }

  @OnEvent('otp.generated')
  handleOtpGenerated(payload: { email: string; otp: string }) {
    this.notificationService.sendEmailOTP(payload.email, payload.otp);
  }
}
