import { Injectable } from '@nestjs/common';
import { IEventProcessor } from './base-processor.interface';
import { TranscribeResultProcessor } from './transcribe-result.processor';
import { UnknownEventProcessor } from './unknown-event.processor';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class ProcessorRegistry {
  private readonly logger = LoggerService.getInstance(ProcessorRegistry.name);
  private readonly processors: Map<string, IEventProcessor> = new Map();

  constructor(
    private readonly transcribeResultProcessor: TranscribeResultProcessor,
    private readonly unknownEventProcessor: UnknownEventProcessor,
  ) {
    this.registerProcessors();
  }

  private registerProcessors(): void {
    this.registerProcessor(this.transcribeResultProcessor);

    this.logger.info(`Registered ${this.processors.size} event processors`);
  }

  private registerProcessor(processor: IEventProcessor): void {
    this.processors.set(processor.getEventType(), processor);
    this.logger.debug(`Registered processor for: ${processor.getEventType()}`);
  }

  public getProcessor(eventType: string): IEventProcessor | undefined {
    return this.processors.get(eventType);
  }

  public async processEvent(eventType: string, data: any): Promise<void> {
    const processor = this.getProcessor(eventType);

    if (processor) {
      await processor.process(data);
    } else {
      await this.unknownEventProcessor.process({ eventType, eventData: data });
    }
  }

  public getRegisteredEventTypes(): string[] {
    return Array.from(this.processors.keys());
  }

  public getProcessorHealth(): Record<string, boolean> {
    const health: Record<string, boolean> = {};

    for (const [eventType, processor] of this.processors) {
      health[eventType] = processor !== undefined;
    }

    return health;
  }

  public registerCustomProcessor(processor: IEventProcessor): void {
    this.registerProcessor(processor);
    this.logger.info(
      `Registered custom processor for: ${processor.getEventType()}`,
    );
  }
}
