import { Injectable } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class SESService {
  private readonly sesClient: SESClient;
  private readonly logger = LoggerService.getInstance(SESService.name);

  constructor(private readonly config: AppConfigService) {
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
      this.logger.error(
        `Failed to send email via SES with error ${JSON.stringify(error)}`,
      );
      return false;
    }
  }
}
