import { Controller, Delete, Get, Query } from '@nestjs/common';
import { RedisService } from '../service/redis.service';

@Controller('v1/cache')
export class CacheController {
  constructor(private readonly redisService: RedisService) {}

  @Get('keys')
  async getKeys(@Query('pattern') pattern: string) {
    return this.redisService.getByPattern(pattern);
  }

  @Delete('keys')
  async deleteKeys(@Query('pattern') pattern: string) {
    return this.redisService.deleteByPattern(pattern);
  }
}
