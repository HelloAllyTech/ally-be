import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/config.service';

@Injectable()
export class RedisService {
  private prefix: string;
  private redis: Redis;

  constructor(private readonly appConfigService: AppConfigService) {
    const { host, port, prefix } = this.appConfigService.redis;
    this.prefix = prefix;
    this.redis = new Redis({
      host,
      port,
    });
  }

  /**
   * Liveness probe for the health check.
   *
   * Deliberately a bare `PING` with a short deadline rather than a set/get
   * round trip: the health endpoint is polled by the load balancer, so it must
   * not write, and it must not be able to hang. ioredis queues commands while
   * disconnected instead of rejecting, so without the timeout a Redis outage
   * would make the health endpoint hang rather than report a failure — which is
   * the opposite of what a health check is for.
   */
  async ping(timeoutMs = 1000): Promise<void> {
    await Promise.race([
      this.redis.ping(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Redis PING did not answer in ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  // Create a new client dynamically (for pub/sub)
  createClient(name: string): Redis {
    return this.redis.duplicate({
      name,
    });
  }

  // ttl in seconds
  async set(key: string, value: string, ttl?: number) {
    const fullKey = this.getFullKey(key);
    if (ttl) {
      await this.redis.set(fullKey, value, 'EX', ttl);
    } else {
      await this.redis.set(fullKey, value);
    }
  }

  async get(key: string) {
    const fullKey = this.getFullKey(key);
    return await this.redis.get(fullKey);
  }

  async del(key: string) {
    const fullKey = this.getFullKey(key);
    await this.redis.del(fullKey);
  }

  private getFullKey(key: string) {
    return `${this.prefix}:${key}`;
  }

  // Best-effort distributed lock. Returns true if the lock was acquired.
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    const result = await this.redis.set(fullKey, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.del(key);
  }

  async getByPattern(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    const stream = this.redis.scanStream({ match: pattern });

    return new Promise((resolve, reject) => {
      stream.on('data', (batch: string[]) => {
        keys.push(...batch);
      });
      stream.on('end', () => resolve(keys));
      stream.on('error', reject);
    });
  }

  async deleteByPattern(pattern: string) {
    const keys = await this.getByPattern(pattern);
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
    return keys;
  }

  // Increment a field in a Redis hash
  async hincrBy(
    key: string,
    field: string,
    increment: number,
  ): Promise<number> {
    const fullKey = this.getFullKey(key);
    return this.redis.hincrby(fullKey, field, increment);
  }

  /**
   * Set a TTL on an existing key.
   *
   * Added for the WhatsApp rate limiter, which needs `hincrBy` (atomic, so two messages arriving
   * together cannot both read the same count) followed by an expiry on first write. Without an
   * expire the counter hashes would accumulate one key per phone number forever.
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    await this.redis.expire(fullKey, ttlSeconds);
  }

  // Get all fields from a Redis hash
  async hgetAll(key: string): Promise<Record<string, string>> {
    const fullKey = this.getFullKey(key);
    return this.redis.hgetall(fullKey);
  }
}
