import { Injectable } from '@nestjs/common';
import { NotificationErrorType } from '../type/notification.error.type';
import { SlackService } from './slack.service';
import { SMSInterface } from '../interface/sms.interface';
@Injectable()
export class NotificationService {
  constructor(
    private readonly slackService: SlackService,
    private readonly smsService: SMSInterface,
  ) {}
  handleException(payload: NotificationErrorType) {
    const { statusCode, timestamp, path, message, type } = payload;
    const slackMessage = `*${type}* - ${message} - ${statusCode} - ${path} - ${timestamp}`;
    this.slackService.sendMessage(slackMessage);
  }

  async sendSMS(to: string, body: string) {
    await this.smsService.sendSMS(to, body);
  }

  async sendOTP(to: string, otp: string) {
    await this.smsService.sendOTP(to, otp);
  }
}
