import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { scheduledTaskRegistry } from '../registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class ScheduledTaskRunnerService {
  private readonly logger = LoggerService.getInstance(
    ScheduledTaskRunnerService.name,
  );

  @Cron(`0 */30 * * * *`)
  async runThirtyMinuteTasks(): Promise<void> {
    await this.runTasksForInterval('30min');
  }

  @Cron(`0 */15 * * * *`)
  async runFifteenMinuteTasks(): Promise<void> {
    await this.runTasksForInterval('15min');
  }

  private async runTasksForInterval(interval: string): Promise<void> {
    const tasks = scheduledTaskRegistry.getHandlers(interval);
    if (tasks.length === 0) return;

    this.logger.debug(
      `Running ${tasks.length} scheduled task(s) for ${interval}`,
    );

    for (const task of tasks) {
      try {
        await task.handler();
        this.logger.debug(`Completed scheduled task: ${task.taskName}`);
      } catch (error) {
        this.logger.error(
          `Scheduled task ${task.taskName} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
