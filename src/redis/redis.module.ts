import { forwardRef, Global, Module } from '@nestjs/common';
import { RedisService } from './service/redis.service';
import { RedisModule as NestRedisModule } from '@liaoliaots/nestjs-redis';
import { CacheController } from './controller/cache.controller';
import { UserModule } from 'src/user/user.module';

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
    forwardRef(() => UserModule),
  ],
  providers: [RedisService],
  exports: [RedisService],
  controllers: [CacheController],
})
export class RedisModule {}
