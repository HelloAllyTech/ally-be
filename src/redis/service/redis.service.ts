import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private prefix: string;
  constructor(private readonly redis: Redis) {
    this.prefix = process.env.REDIS_PREFIX || '';
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
