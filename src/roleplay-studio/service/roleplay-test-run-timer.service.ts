import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';
import { RoleplayTestRunService } from './roleplay-test-run.service';
import {
  IMPROVE_REDIS_KEY_PREFIX,
  TEST_RUN_EXPIRED_CHANNEL,
  TEST_RUN_REDIS_KEY_PREFIX,
} from '../constants/roleplay-studio.constants';

/**
 * Redis keyspace-expiry watchdog for test runs (clone of
 * ScenarioReportTimerService): every run sets a TTL key at creation; if the
 * key expires before the run reaches an end status, the run is failed.
 * The same subscription also watches auto-improve turn keys — a report stuck
 * IMPROVING (server died mid-turn) is failed so its button re-enables.
 *
 * Ops caveat: relies on `notify-keyspace-events Ex`; if CONFIG SET is
 * forbidden (managed Redis), enable it server-side or expired runs will
 * linger until the next webhook/cancel touches them.
 */
@Injectable()
export class RoleplayTestRunTimerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    RoleplayTestRunTimerService.name,
  );
  private subClient: Redis | null = null;

  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly redisService: RedisService,
    private readonly testRunService: RoleplayTestRunService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subClient = this.redisService.createClient(
      'roleplay-test-run-timer-subscriber',
    );

    try {
      await this.subClient.config('SET', 'notify-keyspace-events', 'Ex');
    } catch (error) {
      this.logger.warn(
        `Could not enable Redis keyspace notifications: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.subClient.subscribe(TEST_RUN_EXPIRED_CHANNEL);
    this.subClient.on('message', (channel, expiredKey) => {
      if (channel === TEST_RUN_EXPIRED_CHANNEL) {
        this.handleExpiredKey(expiredKey);
      }
    });
    this.logger.debug(
      'Subscribed to Redis key expiration events for test runs',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subClient) {
      await this.subClient.unsubscribe(TEST_RUN_EXPIRED_CHANNEL);
      this.subClient.disconnect();
      this.subClient = null;
    }
  }

  private handleExpiredKey(expiredKey: string): void {
    const prefix = this.appConfigService.redis.prefix;

    const testRunPrefix = `${prefix}:${TEST_RUN_REDIS_KEY_PREFIX}:`;
    if (expiredKey.startsWith(testRunPrefix)) {
      const runId = expiredKey.slice(testRunPrefix.length);
      if (!runId) return;
      this.logger.debug(`Redis TTL expired for test run: ${runId}`);
      this.testRunService.handleExpiredRun(runId).catch((error) => {
        this.logger.error(
          `Error handling expired test run ${runId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      return;
    }

    const improvePrefix = `${prefix}:${IMPROVE_REDIS_KEY_PREFIX}:`;
    if (expiredKey.startsWith(improvePrefix)) {
      const reportId = expiredKey.slice(improvePrefix.length);
      if (!reportId) return;
      this.logger.debug(
        `Redis TTL expired for auto-improve of report: ${reportId}`,
      );
      this.testRunService.handleExpiredImprove(reportId).catch((error) => {
        this.logger.error(
          `Error handling expired auto-improve for report ${reportId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }
}
