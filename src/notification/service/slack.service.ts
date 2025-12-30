import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
@Injectable()
export class SlackService {
  private apiEndpoint = 'https://slack.com/api/chat.postMessage';
  private botToken;
  private channel;
  private readonly logger = LoggerService.getInstance(SlackService.name);
  constructor(private readonly config: AppConfigService) {
    this.botToken = config.slack.botToken;
    this.channel = config.slack.channel;
  }

  async sendMessage(message: string, channel?: string) {
    try {
      const data = {
        channel: channel || this.channel,
        text: message,
      };
      await axios.post(this.apiEndpoint, data, {
        headers: {
          Authorization: `Bearer ${this.botToken}`,
        },
      });
    } catch (error) {
      this.logger.error('Slack sendMessage error', error);
    }
  }
}
