import { Injectable } from '@nestjs/common';
import { NotificationErrorType } from '../type/notification.error.type';
import { SlackService } from './slack.service';
import { SMSInterface } from '../interface/sms.interface';
import { EmailInterface } from '../interface/email.interface';
@Injectable()
export class NotificationService {
  private ignoreStatusCode = [401];
  constructor(
    private readonly slackService: SlackService,
    private readonly smsService: SMSInterface,
    private readonly emailService: EmailInterface,
  ) {}
  handleException(payload: NotificationErrorType) {
    const { statusCode, timestamp, path, message, type, channel } = payload;
    if (this.ignoreStatusCode.includes(statusCode)) {
      return;
    }
    const slackMessage = `*${type}* - ${message} - ${statusCode} - ${path} - ${timestamp}`;
    this.slackService.sendMessage(slackMessage, channel);
  }

  async sendSMS(to: string, body: string) {
    await this.smsService.sendSMS(to, body);
  }

  async sendOTP(to: string, otp: string) {
    await this.smsService.sendOTP(to, otp);
  }

  async sendEmailOTP(to: string, otp: string) {
    await this.emailService.sendEmailOTP({ to, otp });
  }
}
