import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
  SQSClientConfig,
  SendMessageCommand,
  SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class SqsService {
  private readonly logger = LoggerService.getInstance(SqsService.name);
  private sqsClient!: SQSClient;

  constructor(private readonly config: AppConfigService) {
    this.initializeSqsClient();
  }

  initializeSqsClient(): void {
    const { region, accessKeyId, secretAccessKey, sessionToken } =
      this.config.aws;

    if (!region) {
      this.logger.warn('Missing AWS region. Consumer will not start.');
      return;
    }

    const sqsConfig: SQSClientConfig = {
      region,
    };

    if (accessKeyId && secretAccessKey && sessionToken) {
      sqsConfig.credentials = {
        accessKeyId,
        secretAccessKey,
        sessionToken,
      };
    }

    this.sqsClient = new SQSClient(sqsConfig);
  }

  async sendMessage(
    queueUrl: string,
    message: any,
    options?: Omit<SendMessageCommandInput, 'QueueUrl' | 'MessageBody'>,
  ): Promise<void> {
    try {
      if (!queueUrl) {
        throw new Error('SQS queue URL not configured');
      }

      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        ...options,
      });
      await this.sqsClient.send(command);

      this.logger.debug('Message sent to SQS successfully');
    } catch (error) {
      this.logger.error(
        `Failed to send message to SQS queue: ${queueUrl} with error ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  async receiveMessage(queueUrl: string): Promise<Message[]> {
    try {
      if (!queueUrl) {
        throw new Error('SQS queue URL not configured');
      }

      const command = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        MessageAttributeNames: ['All'],
      });

      const response = await this.sqsClient.send(command);
      return response.Messages || [];
    } catch (error) {
      this.logger.error(
        `Failed to receive response message from SQS queue: ${queueUrl} with error ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  async deleteMessage(queueUrl: string, message: Message): Promise<void> {
    if (!this.sqsClient || !queueUrl || !message.ReceiptHandle) return;

    try {
      const command = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      });

      await this.sqsClient.send(command);
      this.logger.debug(`Deleted message ${message.MessageId}`);
    } catch (err) {
      this.logger.error(
        `Failed to delete message ${message.MessageId} with error ${JSON.stringify(
          err,
        )}`,
      );
    }
  }
}
