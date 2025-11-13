import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
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

  /**
   * Wait until the specified queue exists (by extracting the queue name from the URL
   * and calling GetQueueUrl). Resolves when queue exists, rejects on timeout.
   */
  async waitForQueue(
    queueUrl: string,
    timeoutMs = 30000,
    intervalMs = 1000,
  ): Promise<void> {
    const start = Date.now();

    // Extract queue name from provided QueueUrl (last path segment)
    let queueName: string | null = null;
    try {
      const url = new URL(queueUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      queueName = parts.length > 0 ? parts[parts.length - 1] : null;
    } catch (e) {
      // Fallback: split by /
      const parts = queueUrl.split('/').filter(Boolean);
      queueName = parts.length > 0 ? parts[parts.length - 1] : null;
    }

    if (!queueName) {
      throw new Error(`Unable to extract queue name from URL: ${queueUrl}`);
    }

    while (Date.now() - start < timeoutMs) {
      try {
        const cmd = new GetQueueUrlCommand({ QueueName: queueName });
        await this.sqsClient.send(cmd);
        // found
        return;
      } catch (err: any) {
        // If not found, sleep and retry
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    throw new Error(`Timed out waiting for SQS queue ${queueName}`);
  }

  initializeSqsClient(): void {
    const { region, accessKeyId, secretAccessKey, sessionToken, endpointUrl } =
      this.config.aws as any;

    if (!region) {
      this.logger.warn('Missing AWS region. Consumer will not start.');
      return;
    }

    const sqsConfig: SQSClientConfig = {
      region,
    };

    // If an endpoint URL is provided (e.g. LocalStack), use it so the client
    // directs requests to that host instead of AWS public endpoints.
    if (endpointUrl) {
      // SQSClientConfig.endpoint accepts a string or URL-like value
      // (the AWS SDK will normalize it).
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      sqsConfig.endpoint = endpointUrl;
      this.logger.debug(`Using custom SQS endpoint: ${endpointUrl}`);
    }

    if (accessKeyId && secretAccessKey) {
      sqsConfig.credentials = {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken && { sessionToken }),
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
    } catch (error) {
      this.logger.error(
        `Failed to delete message ${message.MessageId} with error ${JSON.stringify(
          error,
        )}`,
      );
    }
  }
}
