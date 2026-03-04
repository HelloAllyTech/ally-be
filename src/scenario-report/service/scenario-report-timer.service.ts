import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/config.service';
import { RedisService } from '../../redis/service/redis.service';
import { ScenarioReportService } from './scenario-report.service';
import { LoggerService } from '../../logger/logger.service';
import {
  EXPIRED_CHANNEL,
  SCENARIO_REPORT_REDIS_KEY_PREFIX,
} from '../constants/scenario-report.constant';

@Injectable()
export class ScenarioReportTimerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    ScenarioReportTimerService.name,
  );
  private subClient: Redis | null = null;

  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly redisService: RedisService,
    private readonly scenarioReportService: ScenarioReportService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subClient = this.redisService.createClient(
      'scenario-report-timer-subscriber',
    );

    try {
      await this.subClient.config('SET', 'notify-keyspace-events', 'Ex');
      console.log('Redis keyspace notifications enabled');
    } catch (error) {
      this.logger.warn(
        `Could not enable Redis keyspace notifications: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.subClient.subscribe(EXPIRED_CHANNEL);
    this.subClient.on('message', (channel, expiredKey) => {
      console.log('Redis keyspace notification received', channel, expiredKey);
      if (channel === EXPIRED_CHANNEL) {
        this.handleExpiredKey(expiredKey);
      }
    });
    this.logger.debug('Subscribed to Redis key expiration events');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subClient) {
      await this.subClient.unsubscribe(EXPIRED_CHANNEL);
      this.subClient.disconnect();
      this.subClient = null;
    }
  }

  private handleExpiredKey(expiredKey: string): void {
    const prefix = this.appConfigService.redis.prefix;
    const keyPrefix = `${prefix}:${SCENARIO_REPORT_REDIS_KEY_PREFIX}:`;
    if (!expiredKey.startsWith(keyPrefix)) {
      return;
    }
    const reportId = expiredKey.slice(keyPrefix.length);
    if (!reportId) {
      return;
    }
    this.logger.debug(`Redis TTL expired for scenario report: ${reportId}`);
    this.scenarioReportService
      .handleExpiredReportGeneration(reportId)
      .catch((error) => {
        this.logger.error(
          `Error handling expired report ${reportId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
