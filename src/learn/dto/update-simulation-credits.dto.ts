import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive } from 'class-validator';

export class UpdateSimulationCreditsDto {
  @ApiProperty({
    description: 'User ID to update simulation credits for',
    example: 123,
  })
  @IsNumber()
  userId!: number;

  @ApiProperty({
    description: 'Number of total credits (must be >= consumed credits)',
    example: 100,
    minimum: 0,
  })
  @IsNumber()
  @IsInt()
  @IsPositive()
  creditLimit!: number;
}
