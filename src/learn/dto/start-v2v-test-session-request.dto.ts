import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max } from 'class-validator';
import { DEFAULT_SCENARIO_SESSION_TTL_SECONDS } from '../constants/scenario-session.constants';

/**
 * Superadmin V2V test session: start a roleplay where an AI "simulated user"
 * plays the counselor side over voice, so the scenario can be tested end to end
 * without a human tester.
 */
export class StartV2VTestSessionRequestDto {
  @ApiProperty({ description: 'Scenario ID to test', example: 1 })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({ description: 'Language ID', example: 4, required: false })
  @IsOptional()
  @IsNumber()
  languageId?: number;

  @ApiProperty({
    description: 'Room TTL in seconds',
    required: false,
    example: DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
  })
  @IsOptional()
  @IsNumber()
  @Max(DEFAULT_SCENARIO_SESSION_TTL_SECONDS)
  ttl?: number;

  @ApiProperty({
    description:
      'How many counselor turns the simulated user takes before wrapping up the session.',
    required: false,
    example: 12,
  })
  @IsOptional()
  @IsNumber()
  maxExchanges?: number;
}
