import { LoggerService } from 'src/logger/logger.service';

export interface IEventProcessor {
  process(data: any): Promise<void>;
  getEventType(): string;
}

export abstract class BaseEventProcessor implements IEventProcessor {
  abstract process(data: any): Promise<void>;
  abstract getEventType(): string;

  protected logInfo(message: string): void {
    LoggerService.getInstance(this.getEventType()).info(message);
  }

  protected logError(message: string, error?: any): void {
    LoggerService.getInstance(this.getEventType()).error(message, error);
  }
}
