import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, IsString, IsOptional } from 'class-validator';
import { DEFAULT_SCENARIO_SESSION_TTL_SECONDS } from '../constants/scenario-session.constants';

export class StartScenarioSessionRequestDto {
  @ApiProperty({
    description: 'Scenario ID',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description: 'Scenario Path sub-Simulation session ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsOptional()
  scenarioPathSessionItemId?: string;

  @ApiProperty({
    description: 'Case Session Item ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsOptional()
  caseSessionItemId?: string;

  @ApiProperty({
    description: 'TTL in seconds',
    example: DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
  })
  @IsOptional()
  @IsNumber()
  @Max(DEFAULT_SCENARIO_SESSION_TTL_SECONDS)
  ttl?: number;

  @ApiProperty({
    description: 'Language ID',
    example: 4,
  })
  @IsOptional()
  @IsNumber()
  languageId!: number;

}
