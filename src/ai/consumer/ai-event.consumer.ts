import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { LoggerService } from '../../logger/logger.service';
import { ProcessorRegistry } from '../processors/processor-registry';
import { TranscribeAndSummarizeResponseMessage } from '../dto/transcribe-and-summarize-response.model';
import { SqsListener } from 'src/aws/decorators/sqs-listener.decorator';

@Injectable()
export class AiEventConsumer {
  private readonly logger = LoggerService.getInstance(AiEventConsumer.name);

  constructor(private readonly processorRegistry: ProcessorRegistry) {}

  async handleTranscribeAndSummarizeResponse(message: Message): Promise<void> {
    if (!message.Body) return;

    try {
      const responseMessage: TranscribeAndSummarizeResponseMessage = JSON.parse(
        message.Body,
      );

      this.logger.info(`Processing AI event: ${responseMessage.message_type}`);

      await this.processorRegistry.processEvent(
        responseMessage.message_type,
        responseMessage,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${message.MessageId}: ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }
}
