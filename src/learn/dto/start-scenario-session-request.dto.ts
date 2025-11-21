import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, IsOptional, IsString } from 'class-validator';
import { DEFAULT_SCENARIO_SESSION_TTL_SECONDS } from '../constants/scenario-session.constants';

export class StartScenarioSessionRequestDto {
  @ApiProperty({
    description: 'Scenario ID',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description: 'Scenario Path ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsOptional()
  scenarioPathId?: string;

  @ApiProperty({
    description: 'TTL in seconds',
    example: DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
  })
  @IsOptional()
  @IsNumber()
  @Max(DEFAULT_SCENARIO_SESSION_TTL_SECONDS)
  ttl?: number;
}

export class CreateScenarioSessionDto extends StartScenarioSessionRequestDto {
  @IsString()
  @IsOptional()
  scenarioPathSessionItemId?: string;
}
