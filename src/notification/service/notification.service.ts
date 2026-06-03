import { Injectable } from '@nestjs/common';
import { NotificationErrorType } from '../type/notification.error.type';
import { SlackService } from './slack.service';
import { EmailService } from './email.service';
import { AppType } from 'src/common/constants/user.constants';
@Injectable()
export class NotificationService {
  private ignoreStatusCode = [401];
  constructor(
    private readonly slackService: SlackService,
    private readonly emailService: EmailService,
  ) {}
  handleException(payload: NotificationErrorType) {
    const { statusCode, timestamp, path, message, type, channel } = payload;
    if (this.ignoreStatusCode.includes(statusCode)) {
      return;
    }
    const slackMessage = `*${type}* - ${message} - ${statusCode} - ${path} - ${timestamp}`;
    this.slackService.sendMessage(slackMessage, channel);
  }

  /**
   * Posts a Scribe transcription failure to Slack with the underlying reason so
   * failures are visible instead of silently sitting as FAILED. Accepts a single
   * chatId or a batch (used by the stale-chat reaper).
   */
  async notifyTranscriptionFailure(params: {
    reason: string;
    stage: string;
    chatId?: number;
    chatIds?: number[];
  }) {
    const { reason, stage, chatId, chatIds } = params;
    const target = chatId
      ? `Chat ${chatId}`
      : `Chats ${(chatIds ?? []).join(', ')}`;
    const message =
      `:rotating_light: *Scribe transcription failed*\n` +
      `• ${target}\n` +
      `• Stage: ${stage}\n` +
      `• Reason: ${reason}`;
    await this.slackService.sendMessage(message);
  }

  /**
   * Summary alert for the one-time stuck-chat reprocess backfill: how many were
   * re-dispatched for transcription vs. marked FAILED (no recoverable audio).
   */
  async notifyReprocessSummary(params: {
    reprocessed: number[];
    failed: number[];
  }) {
    const { reprocessed, failed } = params;
    const fmt = (ids: number[]) => (ids.length ? ` (${ids.join(', ')})` : '');
    const message =
      `:arrows_counterclockwise: *Scribe stuck-chat backfill*\n` +
      `• Re-dispatched for transcription: ${reprocessed.length}${fmt(reprocessed)}\n` +
      `• Unrecoverable → FAILED: ${failed.length}${fmt(failed)}`;
    await this.slackService.sendMessage(message);
  }

  async sendEmailOTP(
    to: string,
    otp: string,
    magicLinkToken?: string,
    appType?: AppType,
  ) {
    await this.emailService.sendEmailOTP({ to, otp, magicLinkToken, appType });
  }

  async sendEmailSummaryNotification({
    to,
    chatId,
    summaryName,
  }: {
    to: string;
    chatId: number;
    summaryName?: string;
  }) {
    await this.emailService.sendSummaryNotification({
      to,
      chatId,
      summaryName,
    });
  }
}
