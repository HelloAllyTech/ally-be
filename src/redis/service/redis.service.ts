import { Injectable } from '@nestjs/common';
import { RedisService as NestRedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private prefix: string;
  private redis: Redis;
  constructor(private readonly redisService: NestRedisService) {
    this.prefix = process.env.REDIS_PREFIX || '';
    this.redis = this.redisService.getOrThrow();
  }

  async set(key: string, value: string) {
    const fullKey = this.getFullKey(key);
    await this.redis.set(fullKey, value);
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
}
