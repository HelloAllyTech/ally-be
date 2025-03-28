import { Injectable } from '@nestjs/common';
import { NotificationErrorType } from '../type/notification.error.type';
import { SlackService } from './slack.service';

@Injectable()
export class NotificationService {
  constructor(private readonly slackService: SlackService) {}
  handleException(payload: NotificationErrorType) {
    const { statusCode, timestamp, path, message, type } = payload;
    const slackMessage = `*${type}* - ${message} - ${statusCode} - ${path} - ${timestamp}`;
    this.slackService.sendMessage(slackMessage);
  }
}
