import { Injectable } from '@nestjs/common';
import { MessageBroker } from '../interface/message-broker.interface';
import Redis from 'ioredis';
import { RedisService } from '../../redis/service/redis.service';
@Injectable()
export class RedisBrokerService implements MessageBroker {
  private pubClient: Redis;
  private subClient: Redis;

  constructor(private readonly redisService: RedisService) {
    this.pubClient = this.redisService.createClient('publisher');
    this.subClient = this.redisService.createClient('subscriber');
  }

  async publish(channel: string, message: any) {
    await this.pubClient.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: any) => void) {
    await this.subClient.subscribe(channel); //Subscribe to the channel

    this.subClient.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        callback(JSON.parse(message)); //Process only when a message arrives
      }
    });
  }
}
