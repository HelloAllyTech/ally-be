export interface IEventProcessor {
  process(data: any): Promise<void>;
  getEventType(): string;
}

export abstract class BaseEventProcessor implements IEventProcessor {
  abstract process(data: any): Promise<void>;
  abstract getEventType(): string;

  protected logInfo(message: string): void {
    console.log(`[${this.getEventType()}] ${message}`);
  }

  protected logError(message: string, error?: any): void {
    console.error(`[${this.getEventType()}] ERROR: ${message}`, error);
  }
}
