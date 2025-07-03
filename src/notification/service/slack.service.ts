import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import axios from 'axios';
@Injectable()
export class SlackService {
  private apiEndpoint = 'https://slack.com/api/chat.postMessage';
  private botToken;
  private channel;
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
      console.error(error);
    }
  }
}
