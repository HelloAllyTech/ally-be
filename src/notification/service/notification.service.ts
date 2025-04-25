import { Injectable } from '@nestjs/common';
import { NotificationErrorType } from '../type/notification.error.type';
import { SlackService } from './slack.service';

@Injectable()
export class NotificationService {
  private ignoreStatusCode = [401];
  constructor(private readonly slackService: SlackService) {}
  handleException(payload: NotificationErrorType) {
    const { statusCode, timestamp, path, message, type } = payload;
    if (this.ignoreStatusCode.includes(statusCode)) {
      return;
    }
    const slackMessage = `*${type}* - ${message} - ${statusCode} - ${path} - ${timestamp}`;
    this.slackService.sendMessage(slackMessage);
  }
}
