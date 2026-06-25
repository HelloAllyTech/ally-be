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
   * Posts a Scribe transcription failure to Slack with enough context to act on
   * it: the failure *mode* (so on-call can tell an upstream AI error from a
   * dropped result from a reaped/stuck chat), the pipeline stage, the upstream
   * reason, the correlation id (to grep both services), and timing/attempt
   * info when available. Accepts a single chatId or a batch (reaper).
   */
  async notifyTranscriptionFailure(params: {
    reason: string;
    stage: string;
    chatId?: number;
    chatIds?: number[];
    correlationId?: string;
    /**
     * - `explicit-failure`: ally-ai reported a real processing error.
     * - `delivery-failure`: the result callback could not be persisted.
     * - `summary-timeout`: chat sat on Processing past the TTL (reaper).
     * - `dispatch-failure`: we failed to hand the audio to ally-ai.
     */
    mode?:
      | 'explicit-failure'
      | 'delivery-failure'
      | 'summary-timeout'
      | 'dispatch-failure';
    attempt?: number;
    elapsedMs?: number;
  }) {
    const {
      reason,
      stage,
      chatId,
      chatIds,
      correlationId,
      mode,
      attempt,
      elapsedMs,
    } = params;

    const target = chatId
      ? `Chat ${chatId}`
      : `Chats ${(chatIds ?? []).join(', ')}`;

    // Distinct icon per mode so the failure type is scannable at a glance.
    const icon =
      mode === 'summary-timeout'
        ? ':hourglass_flowing_sand:'
        : mode === 'delivery-failure'
          ? ':satellite_antenna:'
          : mode === 'dispatch-failure'
            ? ':outbox_tray:'
            : ':rotating_light:';

    const lines = [
      `${icon} *Scribe transcription failed*${mode ? ` _(${mode})_` : ''}`,
      `• ${target}`,
      `• Stage: ${stage}`,
      `• Reason: ${reason}`,
    ];
    if (correlationId) lines.push(`• Correlation ID: \`${correlationId}\``);
    if (typeof attempt === 'number') lines.push(`• Attempt: ${attempt}`);
    if (typeof elapsedMs === 'number') {
      lines.push(`• Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
    }

    await this.slackService.sendMessage(lines.join('\n'));
  }

  /**
   * Confirmation that a session's transcript was generated and stored (phase 1
   * of two-phase delivery) BEFORE summarisation. Lets us verify in Slack that
   * the transcript is safely persisted independently of the summary outcome.
   */
  async notifyTranscriptStored(params: {
    chatId: number;
    correlationId?: string;
    messageCount?: number;
  }) {
    const { chatId, correlationId, messageCount } = params;
    const lines = [
      `:page_facing_up: *Scribe transcript stored* _(summary pending)_`,
      `• Chat ${chatId}`,
    ];
    if (typeof messageCount === 'number') {
      lines.push(`• Messages: ${messageCount}`);
    }
    if (correlationId) lines.push(`• Correlation ID: \`${correlationId}\``);
    await this.slackService.sendMessage(lines.join('\n'));
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
