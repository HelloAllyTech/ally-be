/**
 * Emitted by `SESService` when a send fails, consumed by
 * `NotificationEventConsumer` and turned into a Slack alert.
 *
 * Lives in `src/notification/type` rather than `src/aws` because the
 * notification side owns the contract; `SESService` only produces it. The event
 * (rather than a direct call) is what keeps AwsModule from depending on
 * NotificationModule, which imports it.
 */
export const EMAIL_SEND_FAILED_EVENT = 'email.send.failed';

export interface EmailSendFailedEvent {
  /** Short label for what the email was for, e.g. 'login OTP'. */
  purpose: string;
  /** The subject line. Ally's subjects are templates, not user content. */
  subject: string;
  recipientCount: number;
  /** Upstream reason from the SES SDK. */
  reason: string;
  /**
   * Recipient DOMAINS only. Enough to spot one tenant's mail host bouncing;
   * never the full addresses, which are PII and do not belong on this path.
   */
  recipientDomains: string[];
}
