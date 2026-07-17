import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { SESService } from 'src/aws/service/ses.service';
import { AppType } from 'src/common/constants/user.constants';

@Injectable()
export class EmailService {
  private readonly logger = LoggerService.getInstance(EmailService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly sesService: SESService,
  ) {}

  async sendEmailOTP(params: {
    to: string;
    otp: string;
    magicLinkToken?: string;
    appType?: AppType;
  }): Promise<boolean> {
    if (this.config.isDevelopment) {
      // TODO: Remove this once email otp is verified in dev
      this.eventEmitter.emit('exception', {
        statusCode: 200,
        timestamp: new Date().toISOString(),
        path: '/api/v1/email/otp',
        message: 'OTP sent to ' + params.to + ' - ' + params.otp,
        type: 'EMAIL OTP',
        channel: 'C0AS8EM1SUT',
      });
    }
    const minutes = Math.floor(this.config.otp.ttl / 60);

    const baseUrl =
      params.appType === AppType.ADMIN
        ? this.config.app.adminBaseUrl
        : this.config.app.baseUrl;

    const magicLink = params.magicLinkToken
      ? `${baseUrl}/auth/verify?token=${params.magicLinkToken}`
      : undefined;

    const subject = 'Your Ally Verification Code';
    const body = `Your Ally Verification Code is:
${params.otp}
${magicLink ? `Or click the link below to login instantly:\n${magicLink}\n` : ''}
⏱️ This security code is valid for the next ${minutes} minutes.
🚫 Do not share this code with anyone.
❌ If you did not request this code, you can safely ignore this email.
`;

    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject,
      body,
      isHtml: false,
    });
  }

  async sendSummaryNotification(params: {
    to: string;
    chatId: number;
    summaryName?: string;
  }): Promise<boolean> {
    const subject = 'Your Ally Call Summary is Ready';
    const summaryLink = `${this.config.app.baseUrl}/summary/${params.chatId}?source=deeplink`;
    const body = `Hello,

Your call summary ${params.summaryName ? `for session ID: ${params.summaryName}` : ''} has been generated and is now available for review.

You can view the complete summary by clicking the link below:
${summaryLink}

Best regards,
The Ally Team`;

    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject,
      body,
      isHtml: false,
    });
  }

  /**
   * Invite an AI Lab evaluator with their portal link and generated
   * credentials. These are low-sensitivity, single-purpose accounts (an
   * evaluator only sees runs assigned to them); the password is generated
   * server-side and shared here in place of the admin copying it manually.
   * Best-effort — returns false on failure without throwing.
   */
  async sendEvaluatorInvite(params: {
    to: string;
    password: string;
  }): Promise<boolean> {
    const portalUrl = `${this.config.app.adminBaseUrl}/evaluate`;
    const subject = "You've been invited to evaluate on Ally AI Lab";
    const body = `Hello,

You've been added as an evaluator on the Ally AI Lab. Sign in to review and score the records assigned to you:

${portalUrl}

Email: ${params.to}
Password: ${params.password}

Please keep these credentials private. If you weren't expecting this, you can ignore this email.

Best regards,
The Ally Team`;

    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject,
      body,
      isHtml: false,
    });
  }
}
