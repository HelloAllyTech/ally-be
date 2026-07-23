import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
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
import { RoleplayTestRunStatus } from '../enum/roleplay-test-run.enum';
import {
  TEST_RUN_DEFAULT_TURNS_PER_CASE,
  TEST_RUN_MAX_CASES,
} from '../constants/roleplay-studio.constants';

export class CreateTestRunDto {
  @ApiProperty({
    description:
      'Agent test cases to run — one simulated session each; content is ' +
      `snapshotted into the run at launch (max ${TEST_RUN_MAX_CASES})`,
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  agentTestCaseIds!: string[];

  @ApiPropertyOptional({ default: TEST_RUN_DEFAULT_TURNS_PER_CASE })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  turnsPerCase?: number;

  @ApiPropertyOptional({
    description:
      'Language the simulated trainee speaks (defaults to the spec language)',
  })
  @IsOptional()
  @IsInt()
  languageId?: number;

  @ApiPropertyOptional({ description: 'LLM judge model override' })
  @IsOptional()
  @IsString()
  judgeModel?: string;

  @ApiPropertyOptional({ description: 'LLM trainee model override' })
  @IsOptional()
  @IsString()
  traineeModel?: string;
}

export class ListTestReportsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * FROZEN ai-learn → ally-be webhook body
 * (PATCH /v1/roleplay-studio/test-runs/webhook/:runId, x-api-key).
 * snake_case fields are the wire contract — ai-learn keeps its internal
 * "rehearsal" naming, so payload keys mirror the old rehearsal webhook plus
 * the rubric extensions (rubric_scores/overall_score/unit_report_markdown).
 */
export class UpdateTestRunWebhookDto {
  @ApiPropertyOptional({ enum: RoleplayTestRunStatus })
  @IsOptional()
  @IsEnum(RoleplayTestRunStatus)
  status?: RoleplayTestRunStatus;

  @ApiPropertyOptional({ description: '{ completed, total }' })
  @IsOptional()
  @IsObject()
  progress?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Aggregate summary: { overall, dimensions, test_case_results: ' +
      '[{ test_case_id, case_type, verdict?, condition_recreated?, ' +
      'rubric_scores?, overall_score?, evidence, reasoning }], test_counts, ' +
      'test_pass_rate (condition verdicts only) }',
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
      '[{ test_case_id, test_case_title, transcript: [{role, content, ' +
      'turn_index, state_id?, stage_direction?}], judge_scores, judge_notes, ' +
      'director_trace, test_result, unit_report_markdown }] — one entry per ' +
      'agent test case, keyed to its report row by test_case_id',
  })
  @IsOptional()
  @IsArray()
  transcripts?: Record<string, any>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error_message?: string;
}
