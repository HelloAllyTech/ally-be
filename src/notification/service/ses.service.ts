import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EmailInterface } from '../interface/email.interface';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class SESService implements EmailInterface {
  private readonly sesClient: SESClient;
  private readonly sourceEmail: string;
  private readonly logger = LoggerService.getInstance(SESService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const region = config.email.ses.region!;
    const accessKeyId = config.email.ses.accessKeyId!;
    const secretAccessKey = config.email.ses.secretAccessKey!;
    const sourceEmail = config.email.ses.sourceEmail!;

    this.sesClient = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    this.sourceEmail = sourceEmail;
  }

  async sendEmail(params: {
    from?: string;
    to: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
  }): Promise<boolean> {
    try {
      const { from, to, subject, body, isHtml = false } = params;
      const toAddresses = Array.isArray(to) ? to : [to];

      await this.sesClient.send(
        new SendEmailCommand({
          Source: from || this.sourceEmail,
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
      this.logger.error(
        `Failed to send email via SES with error ${JSON.stringify(error)}`,
      );
      return false;
    }
  }

  async sendEmailOTP(params: { to: string; otp: string }): Promise<boolean> {
    if (this.config.isDevelopment) {
      // TODO: Remove this once email otp is verified in dev
      this.eventEmitter.emit('exception', {
        statusCode: 200,
        timestamp: new Date().toISOString(),
        path: '/api/v1/sms/otp',
        message: 'OTP sent to ' + params.to + ' - ' + params.otp,
        type: 'EMAIL OTP',
        channel: 'C08T402E3K5',
      });
    }

    const subject = 'Your Ally Verification Code';
    const body = `Your Ally Verification Code is:
${params.otp}

⏱️ This security code is valid for the next 2 minutes.
🚫 Do not share this code with anyone.
❌ If you did not request this code, you can safely ignore this email.
`;

    return this.sendEmail({
      to: params.to,
      subject,
      body,
      isHtml: false,
    });
  }
}
