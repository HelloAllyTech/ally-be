import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from './base-processor.interface';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class UnknownEventProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    UnknownEventProcessor.name,
  );

  getEventType(): string {
    return 'UNKNOWN_EVENT';
  }

  async process(data: any): Promise<void> {
    const { eventType, eventData } = data;

    this.logInfo(`Unknown event type detected: ${eventType}`);
    this.logger.warn(`Event data: ${JSON.stringify(eventData, null, 2)}`);

    this.logInfo(`Event ${eventType} was not processed - no handler found`);
  }
}
