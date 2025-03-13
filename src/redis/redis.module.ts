import { Global, Module } from '@nestjs/common';
import { RedisService } from './service/redis.service';
import { RedisModule as NestRedisModule } from '@liaoliaots/nestjs-redis';

@Global()
@Module({
  imports: [
    NestRedisModule.forRoot({
      config: [
        {
          name: 'default',
          url: process.env.REDIS_URL,
        },
      ],
    }),
  ],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
