import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * GET /v1/analytics/measurement/convergence (EFF-80, AAQ-222, Highlights →
 * Helping skills): "Do the rulers agree?" — can the cheap per-session signals
 * stand in for the foundational helping-skills (FHS) judge?
 *
 * Over SINGLE-SCENARIO scored cuts (every session in the cut ran the same
 * scenario, so a per-session signal and the cut describe the same practice),
 * each cut gets one value per ruler — R1 FHS composite, R2 session score
 * z-scored within its scenario version, R3 behaviour-instruction hit balance,
 * R4 mean skill coverage, R6 learner rating — and every pair of rulers a
 * Spearman rank correlation with its n. ALL-TIME by construction (a
 * correlation over a window would only measure who practised in it); the FHS
 * ruler is pinned to one rubric version; test organisations excluded.
 *
 * Agreement is not validity: two LLM-scored signals can agree and both be
 * wrong. That is what human ratings (EFF-81, AAQ-223) are for. This shape is a
 * frontend contract.
 */
export class MeasurementConvergenceQueryDto {
  @ApiProperty({
    description:
      'Narrow to one org (uuid or code) by the tenant of the session each scored cut closed in, as Helping skills does. ' +
      'The R2 yardstick (each scenario version’s score distribution) stays platform-wide. Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One ruler in the matrix, in display order. */
export class ConvergenceRulerDto {
  @ApiProperty({
    description:
      'Ruler id from the effectiveness plan’s ruler table (R1 = FHS composite, R2 = session score, R3 = behaviour-instruction hits, R4 = skill coverage, R6 = learner rating)',
    enum: ['R1', 'R2', 'R3', 'R4', 'R6'],
  })
  key!: 'R1' | 'R2' | 'R3' | 'R4' | 'R6';

  @ApiProperty({ description: 'Display label' })
  label!: string;

  @ApiProperty({
    description:
      'Exactly how the per-cut value is derived, for the card’s help text',
  })
  description!: string;

  @ApiProperty({
    description: 'Single-scenario cuts with a value on this ruler',
  })
  cuts!: number;
}

/** One cell of the (upper-triangular) correlation matrix. */
export class ConvergencePairDto {
  @ApiProperty({ enum: ['R1', 'R2', 'R3', 'R4', 'R6'] })
  a!: 'R1' | 'R2' | 'R3' | 'R4' | 'R6';

  @ApiProperty({ enum: ['R1', 'R2', 'R3', 'R4', 'R6'] })
  b!: 'R1' | 'R2' | 'R3' | 'R4' | 'R6';

  @ApiProperty({
    description:
      'Single-scenario cuts with a value on BOTH rulers. Present whatever `r` does',
  })
  n!: number;

  @ApiProperty({
    description:
      'Distinct learners behind those cuts. One learner contributes several cuts, so `n` overstates the independent evidence — which is why no interval or p-value is given',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Spearman rank correlation (average ranks for ties), 3 dp, −1..1. Every ruler is oriented higher = better, so agreement is POSITIVE. Null below `minPairs` pairs, or when either ruler is constant over them',
    nullable: true,
    type: Number,
  })
  r!: number | null;
}

export class ConvergenceCutsDto {
  @ApiProperty({
    description:
      'Scored cuts in scope (rubric-pinned, test orgs excluded, org filter applied)',
  })
  total!: number;

  @ApiProperty({
    description:
      'Of those, cuts whose sessions all ran ONE scenario (every session found) — the only cuts compared',
  })
  singleScenario!: number;

  @ApiProperty({
    description: 'singleScenario ÷ total, %; null with no cuts',
    nullable: true,
    type: Number,
  })
  singleScenarioPct!: number | null;
}

export class MeasurementConvergenceResponseDto {
  @ApiProperty({
    description: 'The one rubric version the R1 composite comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Pairs a cell needs before its `r` is shown (MIN_PAIRS_FOR_CONVERGENCE)',
  })
  minPairs!: number;

  @ApiProperty({
    description:
      'Countable scored sessions a scenario version needs before its session scores are z-scored (R2)',
  })
  minSessionsForScoreZ!: number;

  @ApiProperty({ type: () => ConvergenceCutsDto })
  cuts!: ConvergenceCutsDto;

  @ApiProperty({
    type: () => [ConvergenceRulerDto],
    description: 'The rulers, in matrix order',
  })
  rulers!: ConvergenceRulerDto[];

  @ApiProperty({
    type: () => [ConvergencePairDto],
    description:
      'Every pair of rulers once (upper triangle, matrix order): R1–R2, R1–R3, … R4–R6',
  })
  pairs!: ConvergencePairDto[];

  @ApiProperty({
    type: () => ConvergencePairDto,
    nullable: true,
    description:
      'The shown cell with the HIGHEST r (ties: more pairs). Null when no cell clears `minPairs`',
  })
  strongest!: ConvergencePairDto | null;

  @ApiProperty({
    type: () => ConvergencePairDto,
    nullable: true,
    description:
      'The shown cell with the LOWEST r (ties: more pairs). Null until at least two cells are shown',
  })
  weakest!: ConvergencePairDto | null;

  @ApiProperty({
    description:
      'Read beside any cell: agreement is not validity — two LLM-scored signals can agree and both be wrong; human ratings (AAQ-223) are the check. R2 and R3 also share inputs (the session score includes behaviour-instruction points), so part of their agreement is mechanical',
  })
  caveat!: string;

  @ApiProperty({
    type: () => AnalyticsScopingDto,
    description:
      'With `tenantId`, `unscopedSections` names the R2 yardstick (`sessionScoreReference`), which stays platform-wide',
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ type: () => FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ description: 'ISO 8601' })
  computedAt!: string;
}
