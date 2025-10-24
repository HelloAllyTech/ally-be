import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class GetSimulationCreditsDto {
  @ApiProperty({
    description: 'User ID to get simulation credits',
    example: 123,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  userId?: number;
}
