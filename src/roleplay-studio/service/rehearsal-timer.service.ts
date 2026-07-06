import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';
import { RehearsalService } from './rehearsal.service';
import {
  REHEARSAL_EXPIRED_CHANNEL,
  REHEARSAL_REDIS_KEY_PREFIX,
} from '../constants/roleplay-studio.constants';

/**
 * Redis keyspace-expiry watchdog for rehearsal runs (clone of
 * ScenarioReportTimerService): every run sets a TTL key at creation; if the
 * key expires before the run reaches an end status, the run is failed.
 */
@Injectable()
export class RehearsalTimerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    RehearsalTimerService.name,
  );
  private subClient: Redis | null = null;

  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly redisService: RedisService,
    private readonly rehearsalService: RehearsalService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subClient = this.redisService.createClient(
      'roleplay-rehearsal-timer-subscriber',
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

    await this.subClient.subscribe(REHEARSAL_EXPIRED_CHANNEL);
    this.subClient.on('message', (channel, expiredKey) => {
      if (channel === REHEARSAL_EXPIRED_CHANNEL) {
        this.handleExpiredKey(expiredKey);
      }
    });
    this.logger.debug(
      'Subscribed to Redis key expiration events for rehearsals',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subClient) {
      await this.subClient.unsubscribe(REHEARSAL_EXPIRED_CHANNEL);
      this.subClient.disconnect();
      this.subClient = null;
    }
  }

  private handleExpiredKey(expiredKey: string): void {
    const prefix = this.appConfigService.redis.prefix;
    const keyPrefix = `${prefix}:${REHEARSAL_REDIS_KEY_PREFIX}:`;
    if (!expiredKey.startsWith(keyPrefix)) {
      return;
    }
    const rehearsalId = expiredKey.slice(keyPrefix.length);
    if (!rehearsalId) {
      return;
    }
    this.logger.debug(`Redis TTL expired for rehearsal: ${rehearsalId}`);
    this.rehearsalService.handleExpiredRehearsal(rehearsalId).catch((error) => {
      this.logger.error(
        `Error handling expired rehearsal ${rehearsalId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}
