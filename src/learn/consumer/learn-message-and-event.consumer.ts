import { SqsListener } from 'src/aws/decorators/sqs-listener.decorator';
import { Message } from '@aws-sdk/client-sqs';
import { LoggerService } from 'src/logger/logger.service';
import { Injectable } from '@nestjs/common';
import { ProcessorRegistry } from 'src/ai/processors/processor-registry';

@Injectable()
export class LearnMessageAndEventConsumer {
  constructor(private readonly processorRegistry: ProcessorRegistry) {}

  private readonly logger = LoggerService.getInstance(
    LearnMessageAndEventConsumer.name,
  );

  @SqsListener(process.env.SQS_LEARN_MESSAGE_AND_EVENT_QUEUE_URL!)
  async handleLearnMessageAndEvent(message: Message): Promise<void> {
    if (!message.Body) return;

    try {
      const responseMessage = JSON.parse(message.Body);

      this.logger.info(
        `Processing learn message and event: ${responseMessage.message_type}`,
      );

      await this.processorRegistry.processEvent(
        responseMessage.message_type,
        responseMessage,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${message.MessageId}: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }
}
