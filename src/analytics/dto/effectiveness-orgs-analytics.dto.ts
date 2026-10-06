import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Two Effectiveness views that read every learner at once:
 *
 *  - GET /v1/analytics/effectiveness/orgs (EFF-90, AAQ-232, Highlights → Orgs)
 *    — the org effectiveness scorecard: one row per non-test org with its
 *    measurable learners, their own start → now change, the share improving
 *    beyond noise, unhelpful-behaviour change, course completion and
 *    (internal) self-harm cue follow-up. ALL-TIME by construction: every
 *    number is a learner's change against their own earlier self, a lifetime
 *    property a date window would only truncate.
 *  - GET /v1/analytics/effectiveness/cost-per-improvement (EFF-61, AAQ-218,
 *    Highlights → Effectiveness) — learner-caused AI spend in a window ÷ the
 *    learners whose improvement landed in it. A calendar window, so it takes
 *    the shared window params.
 *
 * Ruler R1 (the foundational helping-skills judge, rubric-pinned) for every
 * learner number; R10 (course progress) for completion. Test organisations
 * excluded everywhere. Floors are applied on the server and echoed — a change,
 * average or rate needs `minSampleSize`, a share of people `minCohortSize` —
 * and below a floor the number is null while its count still travels. A null
 * is a decision to withhold, never "zero". This shape is a frontend contract.
 */

const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ─────────────────────────────────────────────────────────────────────────────
// EFF-90 · GET /v1/analytics/effectiveness/orgs
// ─────────────────────────────────────────────────────────────────────────────

/** All-time by construction; the one filter narrows which rows come back. */
export class EffectivenessOrgsQueryDto {
  @ApiProperty({
    description:
      'Return only this org’s row (uuid or code). The noise band, `platform` and `summary` stay ' +
      'platform-wide either way — every org is held to the same band. Omitted: every org with data.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(TENANT_ID_PATTERN, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/**
 * A paired own-baseline change over an org's classifiable learners, floored
 * exactly as Helping skills floors its headline (AAQ-168).
 */
export class EffectivenessOrgChangeDto {
  @ApiProperty({
    description:
      'Learners in the comparison (classifiable learners with a value in both halves). Present whatever the averages do.',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Mean of the learners’ first-half values; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  earlyAvg!: number | null;

  @ApiProperty({
    description:
      'Mean of the same learners’ last-half values; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  lateAvg!: number | null;

  @ApiProperty({
    description:
      'Mean of each learner’s own change (last half − first half); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% paired bootstrap interval of `change` (deterministic); null below `minSampleSize`',
    nullable: true,
    type: [Number],
    example: [0.02, 0.21],
  })
  ci!: [number, number] | null;

  @ApiProperty({ description: 'Learners whose value went up' })
  up!: number;

  @ApiProperty({ description: 'Learners whose value went down' })
  down!: number;

  @ApiProperty({ description: 'Learners who did not move' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down (ties dropped); null with nothing to test',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description:
      'True only when `ci` excludes zero. Always false below `minSampleSize`',
  })
  detectable!: boolean;
}

/** Own-trend classes over an org's classifiable learners. */
export class EffectivenessOrgTrendDto {
  @ApiProperty({
    description:
      'Learners with `thresholds.trendMinCuts`+ scored cuts in this org — the denominator of the shares',
  })
  classifiable!: number;

  @ApiProperty({
    description:
      'Last half of their cuts above their first half by at least the PLATFORM noise band for that many cuts (the Helping skills classification)',
  })
  improving!: number;

  @ApiProperty({ description: 'Inside the noise band' })
  steady!: number;

  @ApiProperty({ description: 'Below their first half by at least the band' })
  declining!: number;

  @ApiProperty({
    description:
      'Classifiable but no platform noise estimate to compare against (too few learners with consecutive cuts)',
  })
  unclassified!: number;

  @ApiProperty({
    description:
      'improving ÷ classifiable, %; null below `minSampleSize` classifiable learners',
    nullable: true,
    type: Number,
  })
  improvingPct!: number | null;

  @ApiProperty({
    description: 'steady ÷ classifiable, %; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  steadyPct!: number | null;

  @ApiProperty({
    description: 'declining ÷ classifiable, %; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  decliningPct!: number | null;
}

/** Course completion, by the learner's own org (ruler R10). */
export class EffectivenessOrgCoursesDto {
  @ApiProperty({
    description: 'Distinct learners of this org with a started enrolment',
  })
  learnersStarted!: number;

  @ApiProperty({
    description:
      'Started enrolments: live enrolments in a live course where the learner opened or completed at least one item (enrolling alone writes `startedAt`, so it is not used)',
  })
  started!: number;

  @ApiProperty({ description: 'Started enrolments with `completedAt` set' })
  completed!: number;

  @ApiProperty({
    description:
      'completed ÷ started, %; null when the row is `belowFloor` or under `minSampleSize` started enrolments',
    nullable: true,
    type: Number,
  })
  completionPct!: number | null;
}

/**
 * Self-harm cue follow-up — the Helping skills AAQ-185 verdicts per org.
 * INTERNAL: unaudited judge coding of a safety behaviour; share only
 * privately with partners.
 */
export class EffectivenessOrgSelfHarmDto {
  @ApiProperty({
    description:
      'Always true: this block is internal (unaudited judge coding of a safety behaviour) — share only privately with partners',
    enum: [true],
  })
  internal!: true;

  @ApiProperty({
    description:
      'Learners of this org with at least one cut that contained a simulated self-harm cue',
  })
  learnersWithCue!: number;

  @ApiProperty({ description: 'Cuts that contained a cue' })
  cutsWithCue!: number;

  @ApiProperty({
    description:
      'Cue cuts where the helper asked about it (harm.b1/b2) and did not miss it',
  })
  cutsFollowedUp!: number;

  @ApiProperty({
    description:
      'Cue cuts where the judge coded a miss (harm.u1) and no follow-up',
  })
  cutsMissed!: number;

  @ApiProperty({
    description:
      'Cue cuts coded both ways, or neither (the cut may end before the helper had room) — unclear, never counted as a miss',
  })
  cutsAmbiguous!: number;

  @ApiProperty({
    description:
      'cutsFollowedUp ÷ (cutsFollowedUp + cutsMissed), %, unclear cuts left out; null when the row is `belowFloor`, fewer than `minCohortSize` learners met a cue, or no cue cut was clear',
    nullable: true,
    type: Number,
  })
  followedUpPct!: number | null;
}

/** Everything a scorecard row says; also the platform-wide reference row. */
export class EffectivenessOrgMetricsDto {
  @ApiProperty({
    description:
      'Learners with at least one scored cut that closed in this org',
  })
  scoredLearners!: number;

  @ApiProperty({
    description:
      'Learners with 2+ scored cuts in this org — the row’s size, the sort key and the floor every rate is gated on',
  })
  measurableLearners!: number;

  @ApiProperty({
    description:
      'Learners with `thresholds.trendMinCuts`+ scored cuts in this org — the population of `composite`, `unhelpful` and `trend`',
  })
  classifiableLearners!: number;

  @ApiProperty({ description: 'Scored cuts that closed in this org' })
  scoredCuts!: number;

  @ApiProperty({
    description:
      'True when `measurableLearners` < `minSampleSize`: the row and every count still travel, every rate, change and sparkline value is null ("withheld")',
  })
  belowFloor!: boolean;

  @ApiProperty({
    type: () => EffectivenessOrgChangeDto,
    description:
      'Composite (1–4) own first half → last half of each classifiable learner’s cuts in this org, paired over learners',
  })
  composite!: EffectivenessOrgChangeDto;

  @ApiProperty({
    type: () => EffectivenessOrgTrendDto,
    description: 'Own-trend classes against the platform noise band',
  })
  trend!: EffectivenessOrgTrendDto;

  @ApiProperty({
    type: () => EffectivenessOrgChangeDto,
    description:
      'Each classifiable learner’s share of slices with an unhelpful behaviour, first half vs last half, in PERCENTAGE POINTS (`earlyAvg`/`lateAvg` are those shares, 0–100). Down is good',
  })
  unhelpful!: EffectivenessOrgChangeDto;

  @ApiProperty({ type: () => EffectivenessOrgCoursesDto })
  courses!: EffectivenessOrgCoursesDto;

  @ApiProperty({
    type: () => EffectivenessOrgSelfHarmDto,
    description: 'Internal — see `internal`',
  })
  selfHarm!: EffectivenessOrgSelfHarmDto;

  @ApiProperty({
    description:
      'Median composite (1–4) of this org’s cuts by calendar month of cut close, index-aligned with `sparkMonths`; null in a month with fewer than `sparkMinCuts` cuts and in every month of a `belowFloor` row. Never zero-filled: no cuts is no measurement',
    type: [Number],
    nullable: true,
    example: [null, 2.4, 2.5, null, 2.6, 2.6],
  })
  spark!: (number | null)[];

  @ApiProperty({
    description:
      'Cuts behind each `spark` month (always present, also below the floor)',
    type: [Number],
    example: [2, 7, 9, 3, 11, 6],
  })
  sparkCuts!: number[];
}

/** One non-test org. */
export class EffectivenessOrgRowDto extends EffectivenessOrgMetricsDto {
  @ApiProperty({ description: 'tenants.id (uuid)' })
  tenantId!: string;

  @ApiProperty({ description: 'Tenant name' })
  tenantName!: string;

  @ApiProperty({
    description: 'Tenant code, where one is set',
    nullable: true,
    type: String,
  })
  code!: string | null;
}

export class EffectivenessOrgsThresholdsDto {
  @ApiProperty({
    description:
      'Scored cuts a learner needs before their own trend is classified',
  })
  trendMinCuts!: number;

  @ApiProperty({ description: 'z for the noise-sized learner band (95%)' })
  learnerBandZ!: number;
}

export class EffectivenessOrgsSummaryDto {
  @ApiProperty({
    description: 'Live, non-test orgs (deleted tenants and test orgs excluded)',
  })
  orgs!: number;

  @ApiProperty({
    description:
      'Orgs with at least one scored cut or one started enrolment — the orgs that get a row (before any `tenantId` narrowing)',
  })
  orgsWithData!: number;

  @ApiProperty({
    description:
      'Of those, rows with at least `minSampleSize` measurable learners',
  })
  orgsAboveFloor!: number;

  @ApiProperty({
    description:
      'Scored cuts whose tenant resolves to no live, non-test org (no tenant recorded, or a deleted tenant). In `platform`, in no row',
  })
  cutsUnattributed!: number;

  @ApiProperty({ description: 'Distinct learners behind `cutsUnattributed`' })
  learnersUnattributed!: number;
}

export class EffectivenessOrgsResponseDto {
  @ApiProperty({
    description: 'The one rubric version every learner number comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Changes, averages and rates over fewer than this many learners (or enrolments) are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Shares of people (the self-harm follow-up share) need at least this many learners',
  })
  minCohortSize!: number;

  @ApiProperty({ type: () => EffectivenessOrgsThresholdsDto })
  thresholds!: EffectivenessOrgsThresholdsDto;

  @ApiProperty({
    description: 'Fixed composite axis for the sparklines',
    type: [Number],
    example: [1, 4],
  })
  scoreDomain!: [number, number];

  @ApiProperty({
    description:
      'Slice-to-slice composite noise estimated over EVERY learner on the platform (the Helping skills AAQ-181 estimate); every org is classified against the band it implies. Null with too few consecutive cuts',
    nullable: true,
    type: Number,
  })
  cutNoiseSd!: number | null;

  @ApiProperty({
    description:
      'The sparkline’s shared axis: calendar months of cut close (`yyyy-mm-01`, UTC), oldest first, ending with the current — still accruing — month',
    type: [String],
    example: [
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ],
  })
  sparkMonths!: string[];

  @ApiProperty({
    description: 'Cuts a sparkline month needs before its median is drawn',
  })
  sparkMinCuts!: number;

  @ApiProperty({ type: () => EffectivenessOrgsSummaryDto })
  summary!: EffectivenessOrgsSummaryDto;

  @ApiProperty({
    type: () => EffectivenessOrgMetricsDto,
    description:
      'The same metrics over every learner on the platform (each learner’s whole series, whichever orgs it spans; enrolments of every org) — the reference row',
  })
  platform!: EffectivenessOrgMetricsDto;

  @ApiProperty({
    type: () => [EffectivenessOrgRowDto],
    description:
      'One row per org with data, most measurable learners first (then scored learners, then name). Never sorted by a rate: this is not a league table',
  })
  orgs!: EffectivenessOrgRowDto[];

  @ApiProperty({
    type: () => AnalyticsScopingDto,
    description:
      '`tenantId` narrows `orgs` only; `platform`, `summary` and `cutNoiseSd` are listed in `unscopedSections` when it is set',
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ type: () => FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ description: 'ISO 8601' })
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EFF-61 · GET /v1/analytics/effectiveness/cost-per-improvement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The shared window params (`range` defaults to `all`, as the roleplay-cost
 * endpoint behind AAQ-076). Platform-wide by construction: AI spend cannot be
 * attributed to one org (most `llm_usage` rows are tenantless), so a `tenantId`
 * is accepted for contract compatibility and IGNORED — `scoping` says so.
 * `bucket` and `compare` have no effect.
 */
export class CostPerImprovementQueryDto extends AnalyticsWindowQueryDto {}

export class CostPerImprovementResponseDto {
  @ApiProperty({
    type: () => AnalyticsWindowDto,
    description:
      'The window, exactly as the roleplay-cost endpoint resolved it for the numerator — the denominator uses the same bounds',
  })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Numerator: learner-caused AI spend in the window, USD, 2 dp — the AAQ-076 "Learner-caused AI spend" figure for the same window (live roleplay, feedback & summary, quiz grading; priced at read time from a hand-maintained list; an estimate, not a bill)',
  })
  spendUsd!: number;

  @ApiProperty({
    description:
      'Learner-caused AI calls in the window with no price on file. They count $0, so `spendUsd` is an understatement when this is non-zero',
  })
  unpricedCalls!: number;

  @ApiProperty({
    description:
      'Denominator: learners classified improving beyond noise (over ALL their scored cuts, against the platform noise band — the Helping skills classification) whose LAST scored cut closed inside the window',
  })
  improvedLearners!: number;

  @ApiProperty({
    description:
      'Classifiable learners (improving, steady or declining) whose last scored cut closed inside the window — the pool `improvedLearners` is drawn from',
  })
  classifiedLearners!: number;

  @ApiProperty({
    description:
      'spendUsd ÷ improvedLearners, USD, 2 dp; null below `minSampleSize` improved learners. A CEILING, not a unit price — see `caveat`',
    nullable: true,
    type: Number,
  })
  costPerImprovedLearnerUsd!: number | null;

  @ApiProperty({
    description:
      'Distinct learners whose roleplay sessions incurred learner-caused spend in the window (session-tagged calls only — quiz grading and other untagged calls cannot name a learner, so this is a lower bound)',
  })
  learnersWithSpend!: number;

  @ApiProperty({
    description: 'Learners classified improving, all time (any window)',
  })
  improvingAllTime!: number;

  @ApiProperty({ description: 'Learners classifiable, all time' })
  classifiableAllTime!: number;

  @ApiProperty({
    description: 'Learners with at least one scored cut, all time',
  })
  measuredLearners!: number;

  @ApiProperty({
    description:
      'Slice-to-slice composite noise over every learner — the band the classification uses',
    nullable: true,
    type: Number,
  })
  cutNoiseSd!: number | null;

  @ApiProperty({
    description: 'The ratio is withheld below this many improved learners',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'The one rubric version the classification comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Read beside the number: spend is attributable to ALL learners, improvement only to the measurable subset (learners with enough scored practice to be classified), and improvement is not caused by spend alone — so this is a ceiling on the cost of one improvement, not a unit price',
  })
  caveat!: string;

  @ApiProperty({
    type: () => AnalyticsScopingDto,
    description:
      'Always platform-wide: `tenantId` is null and every section is listed as unscoped',
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ type: () => FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ description: 'ISO 8601' })
  computedAt!: string;
}
