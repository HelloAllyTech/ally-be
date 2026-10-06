import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Human ratings of foundational-skills cuts — the raters' API (EFF-81).
 *
 *  - GET  /v1/foundational-skills/human-ratings/sample?quarter=YYYYQn
 *  - POST /v1/foundational-skills/human-ratings
 *
 * Raters are internal admins (ANALYTICS toggle). There is no rating UI in this
 * build: a rater opens the sampled cut's sessions in Roleplay Logs, reads the
 * window between its start and end message, and ticks behaviour codes from
 * docs/foundational-helping-skills.md §4. Nothing here carries transcript text.
 */

// ─────────────────────────────────────────────────────────────────────────────
// GET …/human-ratings/sample
// ─────────────────────────────────────────────────────────────────────────────

export class FhsHumanRatingSampleQueryDto {
  @ApiProperty({
    description:
      "Calendar quarter of the cuts' `closedSessionEndedAt`, `YYYYQn`. Omitted: " +
      'the most recent quarter that has ended (a quarter still in progress keeps ' +
      'gaining cuts, so its sample can still move).',
    required: false,
    example: '2026Q3',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}Q[1-4]$/, { message: 'quarter must look like 2026Q3' })
  quarter?: string;
}

export class FhsHumanRatingStratumDto {
  @ApiProperty({
    description: 'Composite tercile, 1 (lowest) … 3, over the quarter’s cuts',
  })
  tercile!: number;

  @ApiProperty({
    description:
      'Majority session language code (`languages.value`), or `unknown`',
  })
  language!: string;

  @ApiProperty({ description: 'Sampleable cuts in this stratum' })
  population!: number;

  @ApiProperty({
    description:
      'How many the sample takes: proportional to `population`, at least 1 per non-empty stratum',
  })
  allocated!: number;
}

export class FhsHumanRatingSampleItemDto {
  @ApiProperty({ description: '`foundational_skill_cuts.id` — what to rate' })
  cutId!: string;

  @ApiProperty({
    description:
      'When the session the cut closed in ended (ISO) — the cut’s place in time',
  })
  closedAt!: string;

  @ApiProperty({
    description:
      'Every session the cut touches, in order — open them in Roleplay Logs',
    type: [String],
  })
  sessionIds!: string[];

  @ApiProperty({
    description:
      'Session and `scenario_session_messages.id` of the first turn in the window',
  })
  startSessionId!: string;

  @ApiProperty()
  startMessageId!: number;

  @ApiProperty({
    description:
      'Session and message id of the helper turn that closed the window. Rate ONLY the turns from start to end inclusive: that is all the judge scored',
  })
  endSessionId!: string;

  @ApiProperty()
  endMessageId!: number;

  @ApiProperty({
    description:
      'The window starts mid-session (earlier turns of that session are context, not rated)',
  })
  startsMidSession!: boolean;

  @ApiProperty({
    description:
      'The window ends mid-session (later turns of that session belong to the next cut)',
  })
  endsMidSession!: boolean;

  @ApiProperty({
    description: 'Majority session language code, or `unknown`',
  })
  language!: string;

  @ApiProperty({
    description:
      "The cut's composite tercile under the JUDGE (1 lowest … 3). For sampling " +
      'audit only: a rating UI must not show it, since a rater who sees the ' +
      "judge's band is no longer rating blind",
  })
  tercile!: number;

  @ApiProperty({
    description:
      'People who have rated this cut under the current rubric version',
  })
  raters!: number;

  @ApiProperty({ description: 'The caller has rated it' })
  ratedByMe!: boolean;

  @ApiProperty({
    description:
      "The cut is the caller's own practice: rating it is refused (rate someone else's)",
  })
  ownPractice!: boolean;
}

export class FhsHumanRatingSampleResponseDto {
  @ApiProperty({ example: '2026Q3' })
  quarter!: string;

  @ApiProperty({ description: 'First day of the quarter, YYYY-MM-DD' })
  quarterStart!: string;

  @ApiProperty({
    description: 'First day of the next quarter, YYYY-MM-DD (exclusive)',
  })
  quarterEnd!: string;

  @ApiProperty({
    description:
      'The quarter has ended. Until it has, late cuts can still move the terciles and the sample',
  })
  quarterComplete!: boolean;

  @ApiProperty({ description: 'The rubric version ratings are stored under' })
  rubricVersion!: string;

  @ApiProperty({
    description: 'Cuts drawn per quarter (HUMAN_RATING_SAMPLE_PER_QUARTER)',
  })
  target!: number;

  @ApiProperty({
    description:
      'Sampleable cuts in the quarter: scored under `rubricVersion` with a composite, non-test orgs',
  })
  population!: number;

  @ApiProperty({
    type: [FhsHumanRatingStratumDto],
    description: 'Tercile × language strata, tercile then language order',
  })
  strata!: FhsHumanRatingStratumDto[];

  @ApiProperty({
    type: [FhsHumanRatingSampleItemDto],
    description:
      '`min(target, population)` cuts, stratum by stratum, each stratum in seeded-hash order. Same quarter and same population → same sample',
  })
  items!: FhsHumanRatingSampleItemDto[];

  @ApiProperty({ description: 'How the sample is drawn, and its caveat' })
  note!: string;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST …/human-ratings
// ─────────────────────────────────────────────────────────────────────────────

export class FhsHumanRatingTicksDto {
  @ApiProperty({
    description: 'Rubric skill key (e.g. `verbal`); every skill, once each',
  })
  @IsString()
  @MaxLength(64)
  skill!: string;

  @ApiProperty({
    description:
      'Whether the window gave this skill an opportunity (the rubric’s “Opportunity” line). False → no ticks, no level',
  })
  @IsBoolean()
  opportunity!: boolean;

  @ApiProperty({
    description:
      'Behaviour codes of THIS skill the rater saw (`<skill>.<u|b|a><n>`). Codes only — no quotes',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  observed?: string[];

  @ApiProperty({
    description:
      'Conditional basic codes of this skill the client never gave the helper a chance to show (e.g. `feedback.b2`)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  notApplicable?: string[];
}

export class SubmitFhsHumanRatingDto {
  @ApiProperty({ description: '`foundational_skill_cuts.id`' })
  @IsUUID()
  cutId!: string;

  @ApiProperty({
    type: [FhsHumanRatingTicksDto],
    description:
      'One entry per rubric skill. Levels are NOT accepted: they are derived from these ticks with the judge’s own rule',
  })
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => FhsHumanRatingTicksDto)
  ticks!: FhsHumanRatingTicksDto[];

  @ApiProperty({
    description:
      'Optional cross-check: "I saw at least one unhelpful behaviour". Stored value is derived from the ticks; a mismatch is rejected as a mis-entry',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  anyUnhelpful?: boolean;
}

export class FhsHumanRatingSkillDto {
  @ApiProperty() skill!: string;
  @ApiProperty() opportunity!: boolean;

  @ApiProperty({
    description:
      'Derived in code from the ticks (any unhelpful → 1 …); null without an opportunity',
    nullable: true,
    type: Number,
  })
  level!: number | null;

  @ApiProperty({ type: [String] }) observed!: string[];
  @ApiProperty({ type: [String] }) notApplicable!: string[];
}

export class FhsHumanRatingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() cutId!: string;
  @ApiProperty() rubricVersion!: string;

  @ApiProperty({
    type: [FhsHumanRatingSkillDto],
    description: 'Every rubric skill, rubric order',
  })
  ticks!: FhsHumanRatingSkillDto[];

  @ApiProperty({ description: 'Any assessed skill scored 1' })
  anyUnhelpful!: boolean;

  @ApiProperty() ratedAt!: string;

  @ApiProperty({
    description:
      'True for a first rating; false when it replaced the caller’s earlier rating of this cut (upsert)',
  })
  created!: boolean;
}
