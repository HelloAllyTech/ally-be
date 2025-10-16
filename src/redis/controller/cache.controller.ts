import { Controller, Delete, Get, Query } from '@nestjs/common';
import { RedisService } from '../service/redis.service';
import { IsString, IsNotEmpty } from 'class-validator';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

class CacheQueryDto {
  @IsString()
  @IsNotEmpty()
  pattern!: string;
}

@Controller('v1/cache')
export class CacheController {
  constructor(private readonly redisService: RedisService) {}

  @Get('keys')
  @AuthPermissions([PERMISSIONS.VIEW_CACHE])
  async getKeys(@Query() query: CacheQueryDto) {
    try {
      return this.redisService.getByPattern(query.pattern);
    } catch (error) {
      throw new Error(`Failed to get cache keys: ${error.message}`);
    }
  }

  @Delete('keys')
  @AuthPermissions([PERMISSIONS.DELETE_CACHE])
  async deleteKeys(@Query() query: CacheQueryDto) {
    try {
      return this.redisService.deleteByPattern(query.pattern);
    } catch (error) {
      throw new Error(`Failed to delete cache keys: ${error.message}`);
    }
  }
}
