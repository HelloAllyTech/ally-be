import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Org health takes NO window params. The question is not "what happened in the
 * last 30 days" but "which customers are fading" — which is a comparison between
 * an all-time relationship, the last four weeks and the four before that, all in
 * one row. A window picker would let a reader shrink the period until every org
 * looked dormant.
 *
 * The one filter is `tenantId`, for looking at a single account without leaving
 * the surface.
 */
export class OrgHealthQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Everything on the row — ' +
      'learners, sessions, credits — is already per-org, so the filter simply ' +
      'restricts which rows come back.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One customer org, as the account-management agenda reads it. */
export class OrgHealthOrgDto {
  @ApiProperty({ description: 'Tenant id (uuid)' })
  tenantId!: string;

  @ApiProperty({ description: 'Tenant name' })
  tenantName!: string;

  @ApiProperty({
    description: 'Tenant code, where one is set',
    nullable: true,
    type: String,
  })
  code!: string | null;

  @ApiProperty({
    description:
      'Learner-group accounts in the org — the size the row travels with, and ' +
      'the reason a rate may be suppressed.',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Distinct learners who completed at least one simulation in the last 28 ' +
      'days. Returned as a COUNT and never as a share of `learners`: for a small ' +
      'org that percentage is a statement about named individuals.',
  })
  activeLearners28d!: number;

  @ApiProperty({ description: 'Completed simulations, all time' })
  completedSimulations!: number;

  @ApiProperty({ description: 'Completed simulations in the last 28 days' })
  completedLast28d!: number;

  @ApiProperty({
    description:
      'Completed simulations in the 28 days BEFORE that — the equal-length ' +
      'comparison basis, so "down by half" is a change and not an artefact of ' +
      'two differently sized periods. 28 days rather than a calendar month for ' +
      'the same reason: four weeks always contain four of each weekday.',
  })
  completedPrev28d!: number;

  @ApiProperty({
    description:
      'When the most recent simulation completed (ISO 8601); null if never',
    nullable: true,
    type: String,
  })
  lastCompletedAt!: string | null;

  @ApiProperty({
    description:
      'Whole days since `lastCompletedAt`; null for an org that has never ' +
      'completed one. The sort key of this table — silence is the signal.',
    nullable: true,
    type: Number,
  })
  daysSinceLastCompleted!: number | null;

  @ApiProperty({
    description:
      'Completed simulations per week for the trailing 12 ISO weeks, index-' +
      'aligned with `trendBuckets`. Zero-filled: a quiet week is a fact, and a ' +
      'sparkline that skips it draws a flat line through a gap.',
    type: [Number],
    example: [4, 6, 0, 0, 2, 9, 11, 7, 3, 0, 0, 1],
  })
  trend!: number[];

  @ApiProperty({
    description:
      "Sum of the org's learners' credit limits. `simulation_credits` is PER " +
      'USER (one row each), so an org figure is a roll-up and not a plan ceiling ' +
      'stored anywhere.',
  })
  creditLimit!: number;

  @ApiProperty({ description: "Sum of the org's learners' consumed credits" })
  consumedCredits!: number;

  @ApiProperty({
    description:
      'consumedCredits / creditLimit as a percentage. NULL when `creditLimit` is ' +
      '0 — "no limit set" is not 0% utilisation, and rendering it as 0% would ' +
      'put every unconfigured org at the safe end of the chart. Also NULL for a ' +
      'below-floor org.',
    nullable: true,
    type: Number,
  })
  creditUtilisationPct!: number | null;

  @ApiProperty({
    description:
      'True when no learner in the org has a non-zero credit limit — the org is ' +
      'uncapped (or unconfigured), which is a different state from "has capacity ' +
      'left" and must not be shown in the same colour.',
  })
  creditsUnset!: boolean;

  @ApiProperty({
    description:
      'True when `learners` is under `minGroupSize`. The row and all of its ' +
      'counts still travel — an account manager needs to see a small account ' +
      'exists — and the derived RATES are suppressed.',
  })
  belowFloor!: boolean;
}

/** The org population this table is a view of. */
export class OrgHealthSummaryDto {
  @ApiProperty({
    description: 'Orgs in scope (test orgs and deleted tenants excluded)',
  })
  orgs!: number;

  @ApiProperty({
    description: 'Orgs with >= 1 completed simulation in the last 28 days',
  })
  activeOrgs!: number;

  @ApiProperty({
    description:
      'The rest: `orgs - activeOrgs`. A residual of a stated population rather ' +
      'than its own measurement, so the two always add up to the denominator ' +
      'above them.',
  })
  dormantOrgs!: number;

  @ApiProperty({
    description: 'Learner-group accounts across every org in scope',
  })
  learners!: number;
}

/**
 * The account-management agenda: which customers are fading, which are near their
 * ceiling.
 *
 * All-time totals plus a fixed trailing 12-week trend, one row per org, sorted
 * "needs attention first": orgs that have gone quiet longest lead, orgs that never
 * started follow (largest first), so the reader works down the list rather than
 * hunting through it.
 */
export class OrgHealthResponseDto {
  @ApiProperty({
    description:
      'One row per org, ordered longest-silence-first, then never-active orgs ' +
      'largest-first. The order is the product judgement of this surface, made ' +
      'once on the server so every client agenda reads the same.',
    type: [OrgHealthOrgDto],
  })
  orgs!: OrgHealthOrgDto[];

  @ApiProperty({
    description:
      '12 ISO week starts (yyyy-mm-dd), oldest first — the SHARED x-axis for ' +
      "every row's sparkline. Sparklines are only comparable down a column if " +
      'they cover the same weeks, so the axis is stated once instead of being ' +
      "implied by each row's own data.",
    type: [String],
  })
  trendBuckets!: string[];

  @ApiProperty({ type: OrgHealthSummaryDto })
  summary!: OrgHealthSummaryDto;

  @ApiProperty({
    description:
      'Smallest learner population a per-org RATE may be stated for. Echoed so ' +
      'the client explains the suppression rather than showing a blank cell.',
  })
  minGroupSize!: number;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'every figure on this surface is per-org by construction.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
