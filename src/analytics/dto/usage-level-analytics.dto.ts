import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Usage levels take NO window params, for the same reason cohort retention does
 * not: the chart is a monthly distribution, and a shift in a distribution is only
 * visible across several months. A `range` of 30 days would render one bar — half
 * of it the unfinished current month — so offering the param and silently
 * ignoring it would be worse than not offering it. The card states the fixed
 * window on its face.
 */
export class UsageLevelQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Both the learner population ' +
      'and the practice activity are scoped, so the percentages stay internally ' +
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

/** One usage band, echoed so the client builds its legend from the server. */
export class UsageLevelBandDto {
  @ApiProperty({ description: 'Admin-facing label', example: '25–50 min' })
  label!: string;

  @ApiProperty({ description: 'Inclusive lower bound, minutes' })
  minMinutes!: number;

  @ApiProperty({
    description: 'Exclusive upper bound, minutes; null for the top band',
    nullable: true,
    type: Number,
  })
  maxMinutes!: number | null;
}

/** One calendar month of the distribution. */
export class UsageLevelMonthDto {
  @ApiProperty({ description: 'First day of the month (yyyy-mm-01)' })
  month!: string;

  @ApiProperty({
    description:
      'Learners in each band, index-aligned with the response `bands`. Counts, ' +
      'not percentages: the client divides by the denominator it is showing, so ' +
      'both definitions share one set of numerators and cannot disagree.',
    type: [Number],
    example: [42, 18, 9, 5, 3, 1, 0],
  })
  learnersByBand!: number[];

  @ApiProperty({
    description:
      'Learners with any practice at all this month — the sum of ' +
      '`learnersByBand`. The zero band is `denominator - activeLearners`, which ' +
      'is why it is not in `learnersByBand`: a learner who never practised has ' +
      'no activity row to count, so that band can only be a residual.',
  })
  activeLearners!: number;

  @ApiProperty({
    description:
      'Learner accounts that existed by the end of this month (cumulative ' +
      'signups). The first, literal reading of "percentage of users".',
  })
  registeredLearners!: number;

  @ApiProperty({
    description:
      'Of those, the ones who had practised at least once by the end of this ' +
      'month. The second reading: it drops learners who never started, so a ' +
      'shift among people who actually use the product stays visible instead of ' +
      'being crushed by a large never-activated population.',
  })
  activatedLearners!: number;

  @ApiProperty({
    description:
      'True for the CURRENT calendar month, which has not finished. Its minutes ' +
      'can only rise, so every learner in it is banded lower than they will ' +
      'finish — the share of the low bands is systematically overstated. Render ' +
      'it as provisional or leave it off the chart; never compare it with the ' +
      'completed months beside it.',
  })
  partial!: boolean;
}

/**
 * Monthly distribution of practice time across the learner population, for the
 * usage-levels chart on the Highlights tab. Fixed 12 complete months plus the
 * current one; month-grained by design.
 */
export class UsageLevelResponseDto {
  @ApiProperty({
    description:
      'Usage bands, lowest first, lower-inclusive and upper-exclusive. ' +
      "Index-aligned with every month's `learnersByBand`. Excludes the zero " +
      'band — see `zeroBandLabel`.',
    type: [UsageLevelBandDto],
  })
  bands!: UsageLevelBandDto[];

  @ApiProperty({
    description:
      'Label for the residual band of learners who practised nothing that ' +
      'month. Its size depends on which denominator the client is showing, so ' +
      'the server sends the label and the client derives the count.',
    example: '0 min',
  })
  zeroBandLabel!: string;

  @ApiProperty({
    description: 'Complete months returned before the current, partial one',
  })
  completeMonths!: number;

  @ApiProperty({
    description:
      'Smallest population a month may be shown as PERCENTAGES for. Below it, ' +
      'the month keeps its counts and loses its shares: a breakdown over a ' +
      'handful of learners names them. The floor is echoed rather than left to ' +
      'the client to invent, and it applies to whichever denominator the client ' +
      'is showing.',
  })
  minPopulationSize!: number;

  @ApiProperty({
    description: 'First day of the current, incomplete month (yyyy-mm-01)',
    example: '2026-07-01',
  })
  currentMonth!: string;

  @ApiProperty({
    description:
      'Oldest first, with no gaps: a month in which nobody practised is present ' +
      'with zero counts, because "nobody practised" is a fact about that month. ' +
      'A month whose denominator is zero (before the population existed) carries ' +
      'zeros too — a share of nobody is undefined, not zero, so the client drops ' +
      'those months rather than drawing them.',
    type: [UsageLevelMonthDto],
  })
  months!: UsageLevelMonthDto[];

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'both the learner population and the practice activity carry a tenant, so ' +
      'the whole chart honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
