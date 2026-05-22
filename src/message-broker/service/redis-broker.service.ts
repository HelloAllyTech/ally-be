import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MessageBroker } from '../interface/message-broker.interface';
import Redis from 'ioredis';
import { RedisService } from '../../redis/service/redis.service';

@Injectable()
export class RedisBrokerService implements MessageBroker, OnModuleDestroy {
  private pubClient: Redis;
  private subClient: Redis;
  private subscribers = new Map<string, Array<(message: any) => void>>();

  constructor(private readonly redisService: RedisService) {
    this.pubClient = this.redisService.createClient('publisher');
    this.subClient = this.redisService.createClient('subscriber');

    // One shared listener fans out to per-channel callbacks. Previously each
    // subscribe() call added a fresh .on('message') handler, causing listener
    // and dispatch growth (O(channels × messages)) over the process lifetime.
    this.subClient.on('message', (channel, message) => {
      const callbacks = this.subscribers.get(channel);
      if (!callbacks || callbacks.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        parsed = message;
      }
      for (const cb of callbacks) {
        try {
          cb(parsed);
        } catch {
          /* callbacks must not break the dispatcher */
        }
      }
    });
  }

  async publish(channel: string, message: any) {
    await this.pubClient.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: any) => void) {
    const existing = this.subscribers.get(channel);
    if (existing) {
      existing.push(callback);
      return;
    }
    this.subscribers.set(channel, [callback]);
    await this.subClient.subscribe(channel);
  }

  async onModuleDestroy() {
    this.subscribers.clear();
    await Promise.allSettled([this.subClient.quit(), this.pubClient.quit()]);
  }
}
