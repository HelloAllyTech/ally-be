import { Controller, Delete, Get, Query } from '@nestjs/common';
import { ApiSecurity, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
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
@ApiSecurity('access-token')
@ApiBearerAuth()
export class CacheController {
  constructor(private readonly redisService: RedisService) {}

  @Get('keys')
  @AuthPermissions([PERMISSIONS.VIEW_CACHE])
  @ApiQuery({
    name: 'pattern',
    required: true,
    type: String,
    description: 'Pattern to match cache keys',
  })
  async getKeys(@Query() query: CacheQueryDto) {
    try {
      return this.redisService.getByPattern(query.pattern);
    } catch (error) {
      throw new Error(`Failed to get cache keys: ${error.message}`);
    }
  }

  @Delete('keys')
  @AuthPermissions([PERMISSIONS.DELETE_CACHE])
  @ApiQuery({
    name: 'pattern',
    required: true,
    type: String,
    description: 'Pattern to match cache keys',
  })
  async deleteKeys(@Query() query: CacheQueryDto) {
    try {
      return this.redisService.deleteByPattern(query.pattern);
    } catch (error) {
      throw new Error(`Failed to delete cache keys: ${error.message}`);
    }
  }
}
