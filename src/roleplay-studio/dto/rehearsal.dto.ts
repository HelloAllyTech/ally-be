import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';

export class CreateRehearsalDto {
  @ApiProperty({ description: 'Language the simulated trainees speak' })
  @IsInt()
  languageId!: number;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  turnsPerProfile?: number;

  @ApiPropertyOptional({ description: 'LLM judge model override' })
  @IsOptional()
  @IsString()
  judgeModel?: string;
}

/**
 * FROZEN ai-learn → ally-be webhook body
 * (PATCH /v1/roleplay-studio/rehearsals/webhook/:rehearsalId, x-api-key).
 * snake_case fields are the wire contract.
 */
export class UpdateRehearsalWebhookDto {
  @ApiPropertyOptional({ enum: RehearsalStatus })
  @IsOptional()
  @IsEnum(RehearsalStatus)
  status?: RehearsalStatus;

  @ApiPropertyOptional({ description: '{ completed, total }' })
  @IsOptional()
  @IsObject()
  progress?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      '{ overall, dimensions: { persona_consistency, disclosure_discipline, difficulty_calibration, rubric_coverage }, per_profile }',
  })
  @IsOptional()
  @IsObject()
  results?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  report_markdown?: string;

  @ApiPropertyOptional({
    description:
      '[{ trainee_profile, transcript: [{role, content, turn_index, state_id?, stage_direction?}], judge_scores, judge_notes, director_trace }]',
  })
  @IsOptional()
  @IsArray()
  transcripts?: Record<string, any>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error_message?: string;
}
