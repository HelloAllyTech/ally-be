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

  /**
   * A message carrying interactive blocks.
   *
   * Separate from `sendMessage` because the failure modes differ: a plain
   * message that does not arrive costs a notification, while a message whose
   * buttons never arrive leaves a person waiting for a control that is not
   * coming. So this reports whether Slack accepted it, and `text` is still
   * sent alongside the blocks — it is what appears in notifications and on
   * clients that cannot render Block Kit.
   */
  async sendBlocks(params: {
    text: string;
    blocks: unknown[];
    channel?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const { data } = await axios.post(
        this.apiEndpoint,
        {
          channel: params.channel || this.channel,
          text: params.text,
          blocks: params.blocks,
        },
        { headers: { Authorization: `Bearer ${this.botToken}` } },
      );
      // Slack answers 200 with `ok:false` for a refusal — an unchecked post
      // looks successful while nothing was delivered.
      if (!data?.ok) {
        this.logger.error(`Slack sendBlocks refused: ${data?.error}`);
        return { ok: false, error: String(data?.error ?? 'unknown') };
      }
      return { ok: true };
    } catch (error) {
      this.logger.error('Slack sendBlocks error', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
