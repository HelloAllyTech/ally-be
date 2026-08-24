import { HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { ErrorCode } from '../../exception/error-code.enum';
import {
  EMAIL_SEND_FAILED_EVENT,
  EmailSendFailedEvent,
} from '../../notification/type/email-send-failed.event';

/**
 * A send that SES refused or could not be handed to SES at all.
 *
 * 503 with `EMAIL_SEND_FAILED`: transient in the overwhelming majority of cases
 * (throttling, a credential rotation, an SES regional blip), so a caller on a
 * request path can honestly tell the user to try again.
 */
export class EmailSendFailedException extends ServiceUnavailableException {
  constructor() {
    // TODO(i18n): English-only, in line with every other exception message in
    // this repo. Deliberately says nothing about SES or the recipient.
    super({
      message: 'We could not send that email. Please try again.',
      error: 'Email delivery failed',
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      errorCode: ErrorCode.EMAIL_SEND_FAILED,
    });
  }
}

@Injectable()
export class SESService {
  private readonly sesClient: SESClient;
  private readonly logger = LoggerService.getInstance(SESService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const region = config.email.ses.region!;
    const accessKeyId = config.email.ses.accessKeyId!;
    const secretAccessKey = config.email.ses.secretAccessKey!;

    this.sesClient = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Send one email.
   *
   * THROWS on failure, and that is the change. This used to `return false` and
   * never throw, which made every failure invisible in a way that compounded
   * down the call chain:
   *
   *   - `AuthService.requestOtp` emits `otp.generated` and returns
   *     `{success: true}` before a send is even attempted, so a user was told
   *     their code was on its way when SES was down.
   *   - `NotificationEventConsumer.handleOtpGenerated` called it with no `await`
   *     and no `catch`, so nothing could observe the result even in principle.
   *   - `LabEvaluatorService.sendInvite` wrapped it in a try/catch that could
   *     never fire — structurally dead code.
   *   - `ChatAiService` logged "Summary-ready email sent" unconditionally,
   *     which is worse than silence: it is a log line asserting something false,
   *     and on-call reading it would rule out the actual fault.
   *
   * Resolving `true` (rather than `void`) is kept so the existing callers that
   * count successes — `StreakReminderService.sendToRecipients` — read the same.
   *
   * @param params.alertOnFailure Defaults to true. Pass false ONLY from a bulk
   *   sender that aggregates its own outcome; one Slack alert per recipient in a
   *   200-recipient batch buries the signal it is meant to raise.
   * @param params.purpose Short label for the alert ("login OTP", "streak
   *   reminder"). Never include recipient content.
   */
  async sendEmail(params: {
    from?: string;
    to: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    alertOnFailure?: boolean;
    purpose?: string;
  }): Promise<boolean> {
    const {
      from,
      to,
      subject,
      body,
      isHtml = false,
      alertOnFailure = true,
      purpose,
    } = params;
    const toAddresses = Array.isArray(to) ? to : [to];

    try {
      await this.sesClient.send(
        new SendEmailCommand({
          Source: from,
          Destination: {
            ToAddresses: toAddresses,
          },
          Message: {
            Subject: {
              Data: subject,
              Charset: 'UTF-8',
            },
            Body: {
              [isHtml ? 'Html' : 'Text']: {
                Data: body,
                Charset: 'UTF-8',
              },
            },
          },
        }),
      );

      this.logger.info(`Email sent to ${toAddresses.join(', ')}`);

      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Failed to send email via SES (purpose=${purpose ?? 'unspecified'}, ` +
          `recipients=${toAddresses.length}): ${reason}`,
      );

      if (alertOnFailure) {
        // Emitted rather than calling NotificationService directly: AwsModule is
        // imported BY NotificationModule, so a direct dependency would close a
        // module cycle. The global event emitter is the existing seam for exactly
        // this, and `NotificationEventConsumer` routes it to the rich Slack
        // alert that `notifyTranscriptionFailure` established.
        this.eventEmitter.emit(EMAIL_SEND_FAILED_EVENT, {
          purpose: purpose ?? 'unspecified',
          subject,
          recipientCount: toAddresses.length,
          reason,
          // Only the domain — an operator needs to know whether one tenant's
          // mail host is bouncing, and the local part is PII this logger is not
          // the audit path for.
          recipientDomains: [
            ...new Set(
              toAddresses.map((address) => address.split('@')[1] ?? 'unknown'),
            ),
          ],
        } satisfies EmailSendFailedEvent);
      }

      throw new EmailSendFailedException();
    }
  }
}
