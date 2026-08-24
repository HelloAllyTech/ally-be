import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../service/notification.service';
import { NotificationErrorType } from '../type/notification.error.type';
import { AppType } from 'src/common/constants/user.constants';
import { LoggerService } from 'src/logger/logger.service';
import {
  EMAIL_SEND_FAILED_EVENT,
  EmailSendFailedEvent,
} from '../type/email-send-failed.event';

@Injectable()
export class NotificationEventConsumer {
  private readonly logger = LoggerService.getInstance(
    NotificationEventConsumer.name,
  );

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('exception')
  handleException(payload: NotificationErrorType) {
    this.notificationService.handleException(payload);
  }

  /**
   * Send the login code.
   *
   * `async` + `await` + `catch`, none of which was here before. The call was
   * fire-and-forget against a `sendEmail` that could not throw, so a failed OTP
   * send was unobservable at every layer: SES swallowed it, this consumer did
   * not wait for it, and `AuthService.requestOtp` had already answered
   * `{success: true}`. A user staring at a code that never arrives was
   * indistinguishable, to us, from a user who never asked.
   *
   * RETURNS a boolean rather than throwing. `AuthService.requestOtp` now uses
   * `emitAsync` and fails its own response when any listener reports `false`, so
   * the outcome has to travel back as a VALUE: rethrowing here would surface as
   * an unhandled rejection out of an event handler, which takes the process
   * down. Losing the service is a worse outcome than one undelivered code.
   */
  @OnEvent('otp.generated')
  async handleOtpGenerated(payload: {
    email: string;
    otp: string;
    magicLinkToken?: string;
    appType?: AppType;
  }): Promise<boolean> {
    try {
      await this.notificationService.sendEmailOTP(
        payload.email,
        payload.otp,
        payload.magicLinkToken,
        payload.appType,
      );
      return true;
    } catch (error) {
      // The domain, not the address — the address is PII and this is not the
      // audit logger. SESService has already raised the Slack alert.
      this.logger.error(
        `Failed to send the login code to a ${
          payload.email?.split('@')[1] ?? 'unknown'
        } address: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }

  @OnEvent(EMAIL_SEND_FAILED_EVENT)
  async handleEmailSendFailed(payload: EmailSendFailedEvent): Promise<void> {
    try {
      await this.notificationService.notifyEmailSendFailure(payload);
    } catch (error) {
      // A failed alert about a failed email must not itself crash the process.
      this.logger.error(
        `Could not raise the email-failure alert: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
