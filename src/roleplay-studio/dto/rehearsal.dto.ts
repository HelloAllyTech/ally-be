import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  RehearsalStatus,
  RehearsalTraineeProfile,
} from '../enum/rehearsal-status.enum';

export class CreateRehearsalDto {
  @ApiPropertyOptional({
    description:
      'Language the simulated trainees speak (defaults to the spec version language)',
  })
  @IsOptional()
  @IsInt()
  languageId?: number;

  @ApiPropertyOptional({
    description:
      'Simulated trainee profiles to run. Omitted → all three; an explicit ' +
      '[] runs a test-case-only rehearsal (requires agentTestCaseIds).',
    enum: RehearsalTraineeProfile,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(RehearsalTraineeProfile, { each: true })
  traineeProfiles?: RehearsalTraineeProfile[];

  @ApiPropertyOptional({
    description:
      'Agent test cases to exercise — one condition-driven session each; ' +
      'content is snapshotted into the run config at launch',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  agentTestCaseIds?: string[];

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
      '{ overall, dimensions: { persona_consistency, disclosure_discipline, difficulty_calibration, rubric_coverage }, per_profile, test_case_results: [{ test_case_id, title, verdict PASSED|FAILED|INCONCLUSIVE, condition_recreated, evidence, reasoning }], test_counts: { passed, failed, inconclusive }, test_pass_rate (int | null when no cases selected) }',
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
      '[{ trainee_profile, transcript: [{role, content, turn_index, state_id?, stage_direction?}], judge_scores, judge_notes, director_trace, test_case_id?, test_case_title?, test_result? }] — test_case_* fields mark condition-driven test-case sessions',
  })
  @IsOptional()
  @IsArray()
  transcripts?: Record<string, any>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error_message?: string;
}
