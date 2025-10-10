import { Controller, Delete, Get, Query } from '@nestjs/common';
import { RedisService } from '../service/redis.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

class CacheQueryDto {
  @IsString()
  @IsNotEmpty()
  pattern!: string;
}

@ApiBearerAuth()
@ApiSecurity('access-token')
@UseGuards(JwtAuthGuard)
@Controller('v1/cache')
export class CacheController {
  constructor(private readonly redisService: RedisService) {}

  @Get('keys')
  async getKeys(@Query() query: CacheQueryDto) {
    try {
      return this.redisService.getByPattern(query.pattern);
    } catch (error) {
      throw new Error(`Failed to get cache keys: ${error.message}`);
    }
  }

  @Delete('keys')
  async deleteKeys(@Query() query: CacheQueryDto) {
    try {
      return this.redisService.deleteByPattern(query.pattern);
    } catch (error) {
      throw new Error(`Failed to delete cache keys: ${error.message}`);
    }
  }
}
