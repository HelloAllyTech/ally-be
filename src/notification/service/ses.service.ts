import { Injectable } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EmailInterface } from '../interface/email.interface';
import { AppConfigService } from '../../config/config.service';

@Injectable()
export class SESService implements EmailInterface {
  private readonly sesClient: SESClient;
  private readonly sourceEmail: string;

  constructor(private readonly config: AppConfigService) {
    const region = config.aws.region!;
    const accessKeyId = config.aws.accessKeyId!;
    const secretAccessKey = config.aws.secretAccessKey!;
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

      return true;
    } catch (error) {
      console.error('Failed to send email via SES:', error);
      return false;
    }
  }

  async sendEmailOTP(params: { to: string; otp: string }): Promise<boolean> {
    const subject = 'Your HelloAlly Verification Code';
    const body = `Use the verification code below to sign in to your HelloAlly account:

${params.otp}

This code is valid for 2 minutes. Please do not share it with anyone.

If you did not request this code, you can safely ignore this email.

— The HelloAlly Team
`;

    return this.sendEmail({
      to: params.to,
      subject,
      body,
      isHtml: false,
    });
  }
}
