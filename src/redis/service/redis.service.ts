import { Injectable } from '@nestjs/common';
import { RedisService as NestRedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private prefix: string;
  private redis: Redis;
  constructor(private readonly redisService: NestRedisService) {
    this.prefix = process.env.REDIS_PREFIX || 'ally';
    this.redis = this.redisService.getOrThrow();
  }

  // Create a new client dynamically (for pub/sub)
  createClient(name: string): Redis {
    const baseClient = this.redisService.getOrThrow();
    return baseClient.duplicate({
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

  async getByPattern(pattern: string) {
    return await this.redis.keys(pattern);
  }

  async deleteByPattern(pattern: string) {
    const keys = await this.redis.keys(pattern);
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
