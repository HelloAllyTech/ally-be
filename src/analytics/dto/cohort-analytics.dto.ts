import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Cohort retention takes NO window params.
 *
 * Every other analytics endpoint honours the page's range picker; this one
 * cannot. A cohort is only readable once it has been followed for several
 * months, so the grid is always all-time and always month-grained — a `range`
 * that silently did nothing would be worse than not offering it. The card
 * states this on its face rather than in a tooltip.
 */
export class CohortRetentionQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Both the cohort population ' +
      'and the activity are scoped, so the percentages stay internally ' +
      'consistent.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One cell of the cohort triangle. */
export class CohortRetentionCellDto {
  @ApiProperty({
    description: 'Whole months since the cohort signed up. Always >= 1.',
  })
  monthIndex!: number;

  @ApiProperty({
    description: 'Calendar month the activity happened in (yyyy-mm-01)',
    example: '2026-03-01',
  })
  activityMonth!: string;

  @ApiProperty({
    description:
      'Learners from this cohort who cleared each minutes threshold in this ' +
      'month, index-aligned with the top-level `thresholds` array. Counts, not ' +
      "percentages — the client divides by the row's `learners` so there is " +
      'one definition of the rate.',
    type: [Number],
    example: [31, 12, 4],
  })
  activeByThreshold!: number[];

  @ApiProperty({
    description:
      'True when this cell falls in the CURRENT calendar month, which has not ' +
      'finished. Its counts can only rise, so it must be rendered as ' +
      'provisional rather than compared with the completed months beside it.',
  })
  partial!: boolean;
}

/** One cohort: the learners who signed up in a given month, followed forward. */
export class CohortRetentionRowDto {
  @ApiProperty({
    description: 'Signup month (yyyy-mm-01) — the cohort key',
    example: '2025-08-01',
  })
  cohortMonth!: string;

  @ApiProperty({
    description:
      'Learner accounts created that month — the denominator for every cell ' +
      'in this row, and the 100% the retention curve starts from.',
  })
  learners!: number;

  @ApiProperty({
    description:
      'True when this cohort is smaller than `minCohortSize`. Its size is ' +
      'still reported, but percentages must be suppressed: a rate over a ' +
      'handful of people both re-identifies them and is mostly noise.',
  })
  belowFloor!: boolean;

  @ApiProperty({
    description:
      'Measured months, starting at monthIndex 1. Month 0 is the signup month ' +
      '— the cohort itself, 100% by definition — and is never measured here. ' +
      'Months with no active learner are present with zero counts (nobody ' +
      'practised is a fact); months that have not happened yet are absent.',
    type: [CohortRetentionCellDto],
  })
  cells!: CohortRetentionCellDto[];
}

/** Monthly cohort retention grid, all-time. */
export class CohortRetentionResponseDto {
  @ApiProperty({
    description:
      'The selectable "active user" definitions, in minutes of simulation ' +
      "practice within a calendar month. Index-aligned with every cell's " +
      '`activeByThreshold`. Ordered loosest to strictest.',
    type: [Number],
    example: [10, 50, 100],
  })
  thresholds!: number[];

  @ApiProperty({
    description:
      'Cohorts smaller than this show their size but not their percentages.',
  })
  minCohortSize!: number;

  @ApiProperty({
    description:
      'First day of the current, incomplete calendar month (yyyy-mm-01). Cells ' +
      'in this month are flagged `partial`.',
    example: '2026-07-01',
  })
  currentMonth!: string;

  @ApiProperty({
    description:
      'Cohorts oldest first, with no gaps: a month in which no learner signed ' +
      'up is present with `learners: 0` and no cells, so the axis stays a real ' +
      'calendar rather than a list of the months that happened to work.',
    type: [CohortRetentionRowDto],
  })
  cohorts!: CohortRetentionRowDto[];

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty ' +
      'here: both the population and the activity can be attributed to a ' +
      'tenant, so the whole grid honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({
    description: 'When this response was computed (ISO 8601)',
  })
  computedAt!: string;
}
