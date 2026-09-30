import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './guard/custom-throttler.guard';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/service/redis.service';
import { AppConfigService } from '../config/config.service';
import { AppConfigModule } from '../config/config.module';
import { registeredThrottlers } from './rate-limit.throttlers';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule, RedisModule],
      inject: [AppConfigService, RedisService],
      useFactory: async (
        configService: AppConfigService,
        redisService: RedisService,
      ) => ({
        throttlers: registeredThrottlers(configService.rateLimit.otp),
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
