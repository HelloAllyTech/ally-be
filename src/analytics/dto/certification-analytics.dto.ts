import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Certification takes NO window params, for a stronger reason than the other
 * fixed-window charts: the threshold is a LIFETIME total, so a window would not
 * narrow this metric, it would change it. Truncating a learner's history moves
 * their crossing later or hides it entirely, and the cumulative line — whose
 * whole point is that it never falls — would fall whenever the window slid.
 * The card states the fixed, all-time window on its face.
 */
export class CertificationQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Both the learner population ' +
      'and their practice activity are scoped, so the counts stay internally ' +
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

/** One certification level, echoed so the client names it from the server. */
export class CertificationLevelDto {
  @ApiProperty({ description: 'Stable id / series key', example: 'L1' })
  id!: string;

  @ApiProperty({
    description: 'Admin-facing name',
    example: 'L1 Ally Certified',
  })
  label!: string;

  @ApiProperty({
    description: 'Lifetime roleplay minutes required, inclusive',
    example: 5000,
  })
  minMinutes!: number;
}

/** One band of the not-yet-certified population. */
export class CertificationPipelineBandDto {
  @ApiProperty({
    description: 'Admin-facing label, built from the bounds',
    example: '1,500–3,000 min',
  })
  label!: string;

  @ApiProperty({ description: 'Inclusive lower bound, minutes' })
  minMinutes!: number;

  @ApiProperty({ description: 'Exclusive upper bound, minutes' })
  maxMinutes!: number;

  @ApiProperty({
    description:
      'Fraction of the level threshold this band starts at, 0–1. Sent so the ' +
      'client can say "60% of the way there" without re-deriving it from ' +
      'minutes and rounding differently.',
    example: 0.3,
  })
  minFraction!: number;

  @ApiProperty({ description: 'Uncertified learners currently in this band' })
  learners!: number;
}

/** One calendar month of certification attainment. */
export class CertificationMonthDto {
  @ApiProperty({ description: 'First day of the month (yyyy-mm-01)' })
  month!: string;

  @ApiProperty({
    description:
      'Distinct learners whose lifetime minutes FIRST reached the threshold ' +
      'in this month. Each learner is counted once, ever, in the month they ' +
      'earned it.',
  })
  newlyCertified!: number;

  @ApiProperty({
    description:
      'Distinct learners certified by the END of this month — the running ' +
      'total of `newlyCertified`. Monotonic by construction: a level is never ' +
      'lost, so this line can only rise or stay flat.',
  })
  cumulativeCertified!: number;

  @ApiProperty({
    description:
      'True for the CURRENT calendar month, which has not finished. More ' +
      'learners can still cross into it, so its bar can only grow and would ' +
      'draw as a fall against the completed month beside it. Render it as ' +
      'provisional or leave it off the plot.',
  })
  partial!: boolean;
}

/**
 * Ally Certification attainment — the platform's hero metric.
 *
 * Distinct learners who have accumulated enough lifetime roleplay practice to
 * hold a level, by the month they earned it and cumulatively over time, plus
 * where the rest of the population stands against the threshold.
 */
export class CertificationResponseDto {
  @ApiProperty({
    description:
      'Every certification level, lowest first. Only the level in `level` is ' +
      'plotted today; the list is echoed so a second level does not need a ' +
      'client change to be named.',
    type: [CertificationLevelDto],
  })
  levels!: CertificationLevelDto[];

  @ApiProperty({
    description: 'The level this response reports on.',
    type: CertificationLevelDto,
  })
  level!: CertificationLevelDto;

  @ApiProperty({
    description:
      'Oldest first, with no gaps: a month in which nobody certified is ' +
      'present with a zero, because "nobody certified" is a fact about that ' +
      'month. The axis spans at least twelve months even when certifications ' +
      'started later, so the cumulative curve has a shape rather than two dots.',
    type: [CertificationMonthDto],
  })
  months!: CertificationMonthDto[];

  @ApiProperty({
    description: 'First day of the current, incomplete month (yyyy-mm-01)',
    example: '2026-08-01',
  })
  currentMonth!: string;

  @ApiProperty({
    description:
      "Distinct learners holding the level right now — the last month's " +
      '`cumulativeCertified`, sent separately so a KPI tile does not have to ' +
      'reach into the tail of an array to find the headline number.',
  })
  certified!: number;

  @ApiProperty({
    description:
      'Every learner in scope, including those who have never practised. The ' +
      'denominator `certified` is a share of.',
  })
  learners!: number;

  @ApiProperty({
    description:
      'The not-yet-certified population by how far along it is, lowest first. ' +
      'The leading indicator the monthly bars cannot be: at this threshold a ' +
      'level takes many months to earn, so crossings read as flat zero for ' +
      'most of the time the platform is in fact succeeding.',
    type: [CertificationPipelineBandDto],
  })
  pipeline!: CertificationPipelineBandDto[];

  @ApiProperty({
    description:
      'Lifetime minutes of the uncertified learner who is furthest along — ' +
      'how close the next certification is. Names nobody. Zero when everyone ' +
      'in scope is already certified, or nobody has practised.',
  })
  nearestMinutes!: number;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is ' +
      'empty: both the learner population and the practice activity carry a ' +
      'tenant, so the whole card honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
