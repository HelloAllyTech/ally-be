import { Injectable } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

@Injectable()
export class SqsService {
  private readonly client: SQSClient;

  constructor() {
    this.client = new SQSClient({
      region: 'us-east-1', // LocalStack default
      endpoint: 'http://localhost:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
  }

  async sendMessage(queueUrl: string, messageBody: string) {
    return this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
      }),
    );
  }

  getClient() {
    return this.client;
  }
}
