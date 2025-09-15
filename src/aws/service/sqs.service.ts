import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
  SQSClientConfig,
  SendMessageCommand,
  SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import { AppConfigService } from '../../config/config.service';

@Injectable()
export class SqsService {
  private readonly logger = new Logger(SqsService.name);
  private sqsClient!: SQSClient;

  constructor(private readonly configService: AppConfigService) {
    this.initializeSqsClient();
  }

  initializeSqsClient(): void {
    const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION } =
      process.env;

    if (!AWS_REGION) {
      this.logger.warn('Missing AWS region. Consumer will not start.');
      return;
    }

    const sqsConfig: SQSClientConfig = {
      region: AWS_REGION,
    };

    if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
      sqsConfig.credentials = {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
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

      this.logger.log('Message sent to SQS successfully');
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
      this.logger.log(`Deleted message ${message.MessageId}`);
    } catch (err) {
      this.logger.error(
        `Failed to delete message ${message.MessageId} with error ${JSON.stringify(
          err,
        )}`,
      );
    }
  }
}
