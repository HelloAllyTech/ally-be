import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './guard/custom-throttler.guard';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/service/redis.service';
import { AppConfigService } from '../config/config.service';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule, RedisModule],
      inject: [AppConfigService, RedisService],
      useFactory: async (
        configService: AppConfigService,
        redisService: RedisService,
      ) => ({
        throttlers: [
          {
            name: 'default',
            limit: 100,
            ttl: 1000,
          },
          {
            name: 'otp',
            limit: configService.rateLimit.otp.limit,
            ttl: configService.rateLimit.otp.ttl,
          },
        ],
        storage: new ThrottlerStorageRedisService(
          redisService.createClient('rate-limit'),
        ),
      }),
    }),
  ],
  providers: [CustomThrottlerGuard],
  exports: [CustomThrottlerGuard],
})
export class RateLimitModule {}
