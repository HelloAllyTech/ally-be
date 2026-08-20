import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';
import {
  USAGE_LADDER_GRAINS,
  UsageLadderGrain,
} from '../repository/usage-ladder-analytics.repository';

/**
 * The ladder is all-time by construction — a lifetime threshold cannot be read
 * over a window without moving every learner's crossing date — so this endpoint
 * takes no range, only the grain its time axis is drawn at.
 */
export class UsageLadderQueryDto {
  @ApiProperty({
    description:
      'Grain of the attainment axis. Month and quarter only: the lowest rung ' +
      'takes weeks to reach, so a finer grain shows noise rather than trend.',
    enum: USAGE_LADDER_GRAINS,
    default: 'month',
    required: false,
  })
  @IsOptional()
  @IsIn(USAGE_LADDER_GRAINS)
  grain?: UsageLadderGrain;

  @ApiProperty({
    description: 'Narrow to a single tenant (uuid or code).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

export class UsageLadderLevelDto {
  @ApiProperty({ description: 'Stable series key, e.g. "L3"' }) id!: string;
  @ApiProperty({ description: 'Admin-facing label' }) label!: string;
  @ApiProperty({ description: 'Lifetime roleplay minutes required, inclusive' })
  minMinutes!: number;
}

/**
 * One period on the attainment axis.
 *
 * `newlyReached` and `cumulative` are index-aligned with `levels`.
 *
 * The two series answer different questions and neither is derivable from the
 * other on the client without the pre-axis history: `newlyReached` is the flow
 * ("how many L3s did we produce in Q2"), `cumulative` the stock ("how many L3s
 * exist"). Learners who crossed before the axis begins are folded into the
 * opening `cumulative` value, so the stock line never starts below the number of
 * people who actually hold the rung.
 */
export class UsageLadderPeriodDto {
  @ApiProperty({ description: 'Period start, yyyy-mm-dd' }) period!: string;

  @ApiProperty({
    description:
      'Learners FIRST reaching each rung in this period, index-aligned with ' +
      '`levels`. A learner who climbed several rungs in one period is counted ' +
      'in each of them, so these series must never be stacked.',
    type: [Number],
  })
  newlyReached!: number[];

  @ApiProperty({
    description:
      'Learners at or past each rung by the END of this period, index-aligned ' +
      'with `levels`. Monotonic: a rung is never lost.',
    type: [Number],
  })
  cumulative!: number[];

  @ApiProperty({
    description:
      'True for the period containing today. It is still accruing, so it can ' +
      'only rise: show it in tables (flagged) and leave it off the plot, where ' +
      'an unfinished period renders as a fall.',
  })
  partial!: boolean;
}

/**
 * One step of the account-created → L1 → … → L5 funnel, as of now.
 *
 * Steps are NESTED, not exclusive: each counts learners at or past that rung, so
 * the series can only narrow. `ofPrevious` is the step-to-step conversion, which
 * is the number that says where people are actually lost; `ofTop` is the share of
 * all accounts, which is the number that says how rare the rung is. Both are
 * given because a funnel read with only one of them invites the reader to
 * calculate the other wrongly.
 */
export class UsageLadderFunnelStepDto {
  @ApiProperty({
    description: 'Step key: "accounts" for the top row, else the level id',
  })
  id!: string;

  @ApiProperty({ description: 'Admin-facing label' }) label!: string;

  @ApiProperty({ description: 'Learners at or past this step' })
  learners!: number;

  @ApiProperty({
    description: 'learners / previous step (%), null on the top row',
    nullable: true,
    type: Number,
  })
  ofPreviousPct!: number | null;

  @ApiProperty({
    description: 'learners / accounts (%), null when there are no accounts',
    nullable: true,
    type: Number,
  })
  ofTopPct!: number | null;
}

export class UsageLadderResponseDto {
  @ApiProperty({ enum: USAGE_LADDER_GRAINS }) grain!: UsageLadderGrain;

  @ApiProperty({
    type: [UsageLadderLevelDto],
    description:
      'The ladder, lowest rung first. Every other array here is index-aligned ' +
      'with it, and legends/labels must be built from it rather than from a ' +
      'second copy on the client.',
  })
  levels!: UsageLadderLevelDto[];

  @ApiProperty({
    type: [UsageLadderPeriodDto],
    description: 'Contiguous period axis, oldest first, gap-filled with zeros',
  })
  periods!: UsageLadderPeriodDto[];

  @ApiProperty({ description: 'Period containing today, yyyy-mm-dd' })
  currentPeriod!: string;

  @ApiProperty({
    type: [UsageLadderFunnelStepDto],
    description: 'Nested funnel, as of now: accounts, then each rung',
  })
  funnel!: UsageLadderFunnelStepDto[];

  @ApiProperty({
    description:
      'Learner accounts in scope — the funnel top row and the denominator of ' +
      'every `ofTopPct`.',
  })
  accounts!: number;

  @ApiProperty({
    description:
      'Lifetime minutes threshold of the Ally Certification, for reference ' +
      'only. This ladder is a SEPARATE internal scale that happens to bracket ' +
      'it; surfaces must not place the two on one axis or call a rung a ' +
      'certification.',
  })
  certificationMinMinutes!: number;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'Server time the aggregates were computed' })
  computedAt!: string;
}
