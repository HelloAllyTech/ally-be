import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';

/** How often a single user's `lastActiveAt` is actually written. */
const TOUCH_THROTTLE_SECONDS = 15 * 60;

/**
 * Keeps `users.lastActiveAt` roughly current without writing on every
 * authenticated request. `JwtStrategy.validate()` runs on essentially every
 * API call, so an unthrottled UPDATE there would add a write per request
 * across the whole platform — the Redis lock (reused as a throttle, same
 * primitive `StreakReminderService` uses for its own dedup) turns that into
 * one write per user per 15 minutes.
 */
@Injectable()
export class LastActiveService {
  private static readonly logger = LoggerService.getInstance(
    LastActiveService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Fire-and-forget: callers must not `await` this from a request's auth
   * path. Never throws — a failure here must not fail authentication.
   */
  async touch(userId: number): Promise<void> {
    try {
      const acquired = await this.redisService.acquireLock(
        `last-active:${userId}`,
        TOUCH_THROTTLE_SECONDS,
      );
      if (!acquired) {
        return;
      }
      await this.dataSource.query(
        `UPDATE "users" SET "lastActiveAt" = NOW() WHERE "id" = $1`,
        [userId],
      );
    } catch (error) {
      LastActiveService.logger.error(
        `Failed to update lastActiveAt for user ${userId}: ${error.message}`,
      );
    }
  }
}
