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
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
      ],
    }),
  ],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
