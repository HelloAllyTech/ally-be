export interface ScheduledTask {
  interval: string;
  taskName: string;
  handler: () => Promise<void>;
}

class ScheduledTaskRegistry {
  private handlers: Map<string, ScheduledTask[]> = new Map();

  register(
    interval: string,
    taskName: string,
    handler: () => Promise<void>,
  ): void {
    if (!this.handlers.has(interval)) {
      this.handlers.set(interval, []);
    }
    this.handlers.get(interval)!.push({ interval, taskName, handler });
  }

  getHandlers(interval: string): ScheduledTask[] {
    return this.handlers.get(interval) ?? [];
  }
}

export const scheduledTaskRegistry = new ScheduledTaskRegistry();
