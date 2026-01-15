import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private prefix: string;
  private redis: Redis;

  constructor() {
    this.prefix = process.env.REDIS_PREFIX || 'ally';
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
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
