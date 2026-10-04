import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, IsString, IsOptional, IsEnum } from 'class-validator';
import { DEFAULT_SCENARIO_SESSION_TTL_SECONDS } from '../constants/scenario-session.constants';
import { SessionPlatform } from '../enum/session-platform.enum';
import { ScenarioInteractionMode } from '../enum/scenario-interaction-mode.enum';

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
    description: 'Track 2.0 item progress ID (roleplay played inside a track)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsString()
  @IsOptional()
  trackItemProgressId?: string;

  @ApiProperty({
    description:
      'Scenario version this session runs against. Defaults to the scenario’s ' +
      'published version when omitted.',
    required: false,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsOptional()
  scenarioVersionId?: string;

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

  @ApiProperty({
    description: 'Client platform that initiated the session',
    enum: SessionPlatform,
    example: SessionPlatform.WEB,
    required: false,
  })
  @IsOptional()
  @IsEnum(SessionPlatform)
  platform?: SessionPlatform;

  @ApiProperty({
    description:
      'VOICE (default) or TEXT. TEXT is accepted only when the learner’s ' +
      'organisation has text-chat roleplays switched on AND the scenario ' +
      'offers text chat; otherwise the start is refused with ' +
      'FEATURE_NOT_ENABLED. Omitted means VOICE, so clients that predate ' +
      'text chat are unaffected.',
    enum: ScenarioInteractionMode,
    example: ScenarioInteractionMode.VOICE,
    required: false,
  })
  @IsOptional()
  @IsEnum(ScenarioInteractionMode)
  interactionMode?: ScenarioInteractionMode;
}
