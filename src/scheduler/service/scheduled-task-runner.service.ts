import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { scheduledTaskRegistry } from '../registry/scheduled-task.registry';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class ScheduledTaskRunnerService {
  private readonly logger = LoggerService.getInstance(
    ScheduledTaskRunnerService.name,
  );

  // Arbitrary but fixed namespace so these advisory locks can't collide with
  // any other advisory lock the app might take in future.
  private static readonly ADVISORY_LOCK_NAMESPACE = 4919;

  constructor(private readonly dataSource: DataSource) {}

  @Cron(`0 */5 * * * *`)
  async runFiveMinuteTasks(): Promise<void> {
    await this.runTasksForInterval('5min');
  }

  @Cron(`0 */30 * * * *`)
  async runThirtyMinuteTasks(): Promise<void> {
    await this.runTasksForInterval('30min');
  }

  @Cron(`0 */15 * * * *`)
  async runFifteenMinuteTasks(): Promise<void> {
    await this.runTasksForInterval('15min');
  }

  @Cron(`0 0 * * * *`)
  async runHourlyTasks(): Promise<void> {
    await this.runTasksForInterval('hourly');
  }

  private async runTasksForInterval(interval: string): Promise<void> {
    const tasks = scheduledTaskRegistry.getHandlers(interval);
    if (tasks.length === 0) return;

    // When the service runs on more than one replica every replica's scheduler
    // fires the same @Cron tick, which would double-run each task (e.g.
    // re-dispatching the same stuck chats twice). Guard each interval with a
    // Postgres session-level advisory lock so only the replica that wins the
    // lock runs that tick's tasks; the others skip. The lock is acquired and
    // released on the SAME pooled connection (a dedicated QueryRunner), and
    // Postgres auto-releases it if that connection dies, so it can't get stuck.
    const lockKey = ScheduledTaskRunnerService.hashInterval(interval);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [ScheduledTaskRunnerService.ADVISORY_LOCK_NAMESPACE, lockKey],
      );
      if (!rows?.[0]?.locked) {
        this.logger.debug(
          `Skipping ${interval} scheduled tasks — another replica holds the lock`,
        );
        return;
      }

      try {
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
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1, $2)', [
          ScheduledTaskRunnerService.ADVISORY_LOCK_NAMESPACE,
          lockKey,
        ]);
      }
    } finally {
      await runner.release();
    }
  }

  /** Stable djb2 hash of the interval name into a positive int4 lock key. */
  private static hashInterval(interval: string): number {
    let hash = 5381;
    for (let i = 0; i < interval.length; i += 1) {
      hash = ((hash << 5) + hash + interval.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 2147483647;
  }
}
