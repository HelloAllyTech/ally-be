import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';
import { WhatsAppBotSettings } from '../type/whatsapp-settings.type';

interface Window {
  label: string;
  seconds: number;
  limit: number;
}

@Injectable()
export class WhatsAppRateLimitService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppRateLimitService.name,
  );

  constructor(private readonly redisService: RedisService) {}

  /**
   * Per-phone-number rate limiting.
   *
   * NOT the `@RateLimit` decorator. That guard's tracker only understands `ip` and `userId`
   * (src/rate-limit/guard/custom-throttler.guard.ts), and every webhook request arrives from Meta's
   * IP with no authenticated user — so the decorator would put every worker in the world into one
   * shared bucket and throttle them collectively. It is also a no-op when `isLocal`.
   *
   * Called AFTER dedupe in the consumer, deliberately: a redelivered message must not consume the
   * sender's budget a second time.
   *
   * Counters are keyed by the window itself (`...:m:29123456`), so an expired window's key is simply
   * a different key — no sliding-window bookkeeping and no cleanup pass. `hincrBy` is atomic, so two
   * messages arriving in the same instant cannot both read the same count; the TTL is set only on the
   * first increment of a window.
   */
  async check(
    phone: string,
    settings: WhatsAppBotSettings,
  ): Promise<{ allowed: boolean; window?: string }> {
    const now = Date.now();
    const windows: Window[] = [
      {
        label: 'minute',
        seconds: 60,
        limit: settings.rateLimit.perMinute,
      },
      { label: 'hour', seconds: 3600, limit: settings.rateLimit.perHour },
      { label: 'day', seconds: 86_400, limit: settings.rateLimit.perDay },
    ];

    for (const window of windows) {
      if (!window.limit || window.limit <= 0) continue;

      const bucket = Math.floor(now / (window.seconds * 1000));
      const key = `wa:rl:${phone}:${window.label}:${bucket}`;

      let count: number;
      try {
        count = await this.redisService.hincrBy(key, 'n', 1);
        if (count === 1) {
          // Only on the first increment: re-setting it every message would let a steady stream keep
          // the key alive indefinitely, which for a window-keyed counter is harmless but pointless.
          await this.redisService.expire(key, window.seconds + 60);
        }
      } catch (error) {
        // Fail OPEN. Redis being down must not silence the bot — a worker with a real question is
        // better served by an answer than by a throttle notice caused by our own outage. The abuse
        // risk of a brief open window is much smaller than the cost of a mute bot.
        this.logger.error(
          `Rate-limit check failed (allowing the message): ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        return { allowed: true };
      }

      if (count > window.limit) {
        return { allowed: false, window: window.label };
      }
    }

    return { allowed: true };
  }

  /**
   * Whether the throttle notice has already been sent for this window.
   *
   * Without this a number that keeps sending gets a throttle reply to every single message, which is
   * both a spam loop we are paying Meta for and a worse experience than silence.
   */
  async shouldNotify(phone: string, window: string): Promise<boolean> {
    const key = `wa:rl:notified:${phone}:${window}`;
    try {
      const existing = await this.redisService.get(key);
      if (existing) return false;
      await this.redisService.set(key, '1', 300);
      return true;
    } catch {
      // If we cannot tell, stay quiet: a missed notice is better than a loop of them.
      return false;
    }
  }
}
