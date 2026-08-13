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
    unrecoverable: number[];
    // Chats that threw during reprocess — NOT confirmed unrecoverable; their
    // audio is untouched so they may retry. Reported separately (and only when
    // present) so a recurring error is visible instead of being counted as
    // "unrecoverable". Optional for backward compatibility with older callers.
    errored?: number[];
  }) {
    const { reprocessed, unrecoverable, errored = [] } = params;
    const fmt = (ids: number[]) => (ids.length ? ` (${ids.join(', ')})` : '');
    let message =
      `:arrows_counterclockwise: *Scribe stuck-chat backfill*\n` +
      `• Re-dispatched for transcription: ${reprocessed.length}${fmt(reprocessed)}\n` +
      `• Unrecoverable → FAILED: ${unrecoverable.length}${fmt(unrecoverable)}`;
    if (errored.length) {
      message +=
        `\n• :warning: Errored (audio untouched, will retry until attempt cap): ` +
        `${errored.length}${fmt(errored)}`;
    }
    await this.slackService.sendMessage(message);
  }

  /**
   * The bug-hunter agent's "I'm stuck, interrupt me" channel — the loud tier
   * in the plan's three-tier escalation design. Fires for: local tests still
   * red after the fix-attempt cap, a finding that would touch a guarded path
   * (auth/payments/migrations), or a run that errored out. Everything else
   * the agent finds waits quietly in the Analytics Suggestions review queue,
   * so this message landing at all is itself the signal something needs a
   * human now rather than at the next review pass.
   */
  async notifyBugHunterEscalation(params: {
    runId: string;
    repo: string;
    summary: string;
    payload?: Record<string, any>;
  }) {
    const { runId, repo, summary, payload } = params;
    const lines = [
      `:rotating_light: *Bug Hunter escalation* — ${repo}`,
      `• ${summary}`,
      `• Run: \`${runId}\``,
    ];
    if (payload && Object.keys(payload).length) {
      lines.push(`• Detail: ${JSON.stringify(payload)}`);
    }
    await this.slackService.sendMessage(lines.join('\n'));
  }

  /**
   * End-of-run summary. Only sent for a FAILED run, a run that escalated, or
   * a run that found at least one bug — a healthy empty night stays silent,
   * matching the "pull, not push" design for the two quieter escalation
   * tiers (see BugHunterService.closeRun).
   */
  async notifyBugHunterRunSummary(params: {
    runId: string;
    repo: string;
    status: string;
    foundCount: number;
    autoMergedCount: number;
    prOpenedCount: number;
    dismissedCount: number;
    totalTokenCostUsd: string;
  }) {
    const {
      runId,
      repo,
      status,
      foundCount,
      autoMergedCount,
      prOpenedCount,
      dismissedCount,
      totalTokenCostUsd,
    } = params;
    const icon = status === 'failed' ? ':x:' : ':mag:';
    const lines = [
      `${icon} *Bug Hunter run ${status}* — ${repo}`,
      `• Found: ${foundCount} · Auto-merged: ${autoMergedCount} · PR-pending review: ${prOpenedCount} · Dismissed: ${dismissedCount}`,
      `• Est. cost: $${totalTokenCostUsd}`,
      `• Run: \`${runId}\``,
    ];
    await this.slackService.sendMessage(lines.join('\n'));
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
