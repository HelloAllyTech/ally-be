import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Roleplay volume takes NO window params, for the same reason cohort retention
 * and usage levels do not: the quantity being distributed is a LIFETIME count.
 * Over a 30-day window nearly every learner falls in the "1" or "2" band whatever
 * their real depth, so the chart would be reporting the length of the window.
 * Offering `range` and silently ignoring it would be worse than not offering it;
 * the card states the window on its face.
 */
export class RoleplayVolumeQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Both the learner population ' +
      'and the completed roleplays are scoped, so the percentages stay ' +
      'internally consistent.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One volume band, echoed so the client builds its axis from the server. */
export class RoleplayVolumeBandDto {
  @ApiProperty({ description: 'Admin-facing label', example: '3–5' })
  label!: string;

  @ApiProperty({ description: 'Inclusive lower bound, completed roleplays' })
  minCount!: number;

  @ApiProperty({
    description:
      'INCLUSIVE upper bound; null for the open-ended top band. Inclusive on ' +
      'both ends unlike the minute bands on /usage-levels: a roleplay count is ' +
      'discrete, so "3–5" means 3, 4 or 5.',
    nullable: true,
    type: Number,
  })
  maxCount!: number | null;
}

/**
 * Lifetime distribution of completed roleplays across the learner population, for
 * the roleplay-volume chart on the Highlights tab. All-time by design.
 */
export class RoleplayVolumeResponseDto {
  @ApiProperty({
    description:
      'Bands, lowest first, inclusive on both bounds. Index-aligned with ' +
      '`learnersByBand`. Excludes the zero band — see `zeroBandLabel`.',
    type: [RoleplayVolumeBandDto],
  })
  bands!: RoleplayVolumeBandDto[];

  @ApiProperty({
    description:
      'Label for the residual band of learners who have never completed a ' +
      'roleplay. A learner with no completed session has no row to count, so ' +
      'that band is `registeredLearners - learnersWithAny` rather than something ' +
      'the session table can be asked for.',
    example: '0',
  })
  zeroBandLabel!: string;

  @ApiProperty({
    description:
      'Smallest population this distribution may be shown as PERCENTAGES for. ' +
      'Below it the counts still stand and the shares must not be stated: "50% ' +
      'of learners have never practised" over a population of two names them. ' +
      'The floor is echoed rather than left to the client to invent.',
  })
  minPopulationSize!: number;

  @ApiProperty({
    description:
      'Every learner account in scope, whether or not they ever practised — the ' +
      'denominator for every share on this chart.',
  })
  registeredLearners!: number;

  @ApiProperty({
    description:
      'Learners with at least one completed roleplay. The sum of ' +
      '`learnersByBand`.',
  })
  learnersWithAny!: number;

  @ApiProperty({
    description:
      'The residual zero band: learners who have never completed a roleplay. ' +
      'Derived as `registeredLearners - learnersWithAny`, clamped at zero, and ' +
      'returned rather than left to the client so the two cannot disagree.',
  })
  learnersWithNone!: number;

  @ApiProperty({
    description:
      'Learners in each band, index-aligned with `bands`. Counts, not ' +
      'percentages: the client divides by the denominator it is showing, so both ' +
      'the chart and the table share one set of numerators.',
    type: [Number],
    example: [318, 142, 96, 41, 18, 6, 2],
  })
  learnersByBand!: number[];

  @ApiProperty({
    description:
      'Completed roleplays across every learner in scope — the volume this ' +
      'distribution splits up.',
  })
  totalCompletedRoleplays!: number;

  @ApiProperty({
    description:
      'Median lifetime count among learners who have completed AT LEAST ONE; ' +
      'null when nobody has. The zeros are excluded deliberately: with a large ' +
      'never-activated population the all-learner median sits at 0 for months, ' +
      'which is a fact about activation and says nothing about depth.',
    nullable: true,
    type: Number,
  })
  medianAmongActiveLearners!: number | null;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'both the learner population and the sessions carry a tenant, so the whole ' +
      'chart honours the filter.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
