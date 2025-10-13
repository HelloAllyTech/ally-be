import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, IsOptional } from 'class-validator';

export class StartScenarioSessionRequestDto {
  @ApiProperty({
    description: 'Scenario ID',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description: 'TTL in seconds',
    example: 1800,
  })
  @IsOptional()
  @IsNumber()
  @Max(1800)
  ttl?: number;
}
