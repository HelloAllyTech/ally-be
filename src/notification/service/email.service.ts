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
        channel: 'C08T402E3K5',
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
}
