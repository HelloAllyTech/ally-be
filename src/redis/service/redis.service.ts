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

  // Get all fields from a Redis hash
  async hgetAll(key: string): Promise<Record<string, string>> {
    const fullKey = this.getFullKey(key);
    return this.redis.hgetall(fullKey);
  }
}
