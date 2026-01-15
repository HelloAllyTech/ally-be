import { Global, Module } from '@nestjs/common';
import { RedisService } from './service/redis.service';
import { CacheController } from './controller/cache.controller';

@Global()
@Module({
  imports: [],
  providers: [RedisService],
  exports: [RedisService],
  controllers: [CacheController],
})
export class RedisModule {}
