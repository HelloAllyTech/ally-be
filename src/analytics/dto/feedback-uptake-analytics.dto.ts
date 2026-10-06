import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';

/**
 * Named improvements that were acted on — GET
 * /v1/analytics/foundational-skills/feedback-uptake (EFF-40, chart AAQ-221 on
 * Highlights → Helping skills).
 *
 * The question: when a session's debrief tells a learner to work on a skill,
 * does that skill change?
 *
 * Every debrief's "areas of growth" are filed under foundational helping
 * skills by a scheduled model call (`session_feedback_skill_links`, one
 * `mapperVersion` per response). For each mapped session S of a learner:
 *
 *  - **before** = their last scored cut that CLOSED at or before S ended —
 *    every word in it was spoken before the debrief existed;
 *  - **after** = their first scored cut whose FIRST session ended after S
 *    ended — every session in it came after the debrief. A cut that straddles
 *    S belongs to neither side (course impact's rule, with S's end as both
 *    edges).
 *
 * Sessions sharing the same before and after cut are one WINDOW: a skill is
 * NAMED in a window when any of its debriefs named it, and UNNAMED when none
 * did. Only skills assessable in both cuts count. Each (window, skill) is an
 * observation: the level (1–4) rose, held or fell.
 *
 * Per learner, observations collapse to ONE share per skill per role
 * (named / unnamed), so a learner with many sessions is still one person; the
 * pooled row collapses each learner across all skills. The headline is the
 * within-learner difference in "rose" share, named − unnamed, over learners
 * who have both, with a deterministic bootstrap interval over learners.
 *
 * ALL-TIME by construction (the axis is "before vs after a session", not a
 * date). Test organisations excluded; one rubric version (ruler R1) and one
 * mapper version. Floors on the server: below `minSampleSize` learners a share
 * or a difference is null while its counts still travel. This shape is a
 * frontend contract.
 *
 * Observational. The named skill is usually the one that was weak, so
 * regression to the mean inflates its "rose" — the unnamed control is there
 * for that, and `beforeLevelAvg` shows how far apart the two arms started.
 */

export class FeedbackUptakeQueryDto {
  @ApiProperty({
    description:
      "Narrow to a single tenant (uuid or code): the sessions' own org and the cuts' own org. " +
      'Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One role (named or unnamed) of one skill, or of every skill pooled. */
export class FeedbackUptakeArmDto {
  @ApiProperty({
    description:
      'Learners with at least one observation in this role. Present whatever the shares do',
  })
  learners!: number;

  @ApiProperty({
    description:
      '(window, skill) observations behind those learners, before the per-learner collapse',
  })
  observations!: number;

  @ApiProperty({
    description:
      'Mean over learners of their own share of observations where the level ROSE, 0–100; null below `minSampleSize` learners',
    nullable: true,
    type: Number,
  })
  rosePct!: number | null;

  @ApiProperty({
    description:
      'The same, for observations where the level HELD; null below `minSampleSize` learners',
    nullable: true,
    type: Number,
  })
  heldPct!: number | null;

  @ApiProperty({
    description:
      'The same, for observations where the level FELL; null below `minSampleSize` learners',
    nullable: true,
    type: Number,
  })
  fellPct!: number | null;

  @ApiProperty({
    description:
      'Mean over learners of their own mean level (1–4) in the BEFORE cut — how weak the skill was when the debrief arrived. A gap between the arms is regression-to-the-mean headroom. Null below `minSampleSize` learners',
    nullable: true,
    type: Number,
  })
  beforeLevelAvg!: number | null;
}

/**
 * Named − unnamed, within learner: each learner's "rose" share when the skill
 * was named, minus their own "rose" share when it was not.
 */
export class FeedbackUptakeDifferenceDto {
  @ApiProperty({
    description:
      'Learners with BOTH a named and an unnamed observation (on this skill, or on any skill for the pooled row)',
  })
  learners!: number;

  @ApiProperty({
    description:
      'These learners\' mean named "rose" share, 0–100; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  namedRosePct!: number | null;

  @ApiProperty({
    description:
      'The same learners\' mean unnamed "rose" share, 0–100; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  unnamedRosePct!: number | null;

  @ApiProperty({
    description:
      'Mean of each learner’s own (named − unnamed) "rose" share, in percentage points; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% bootstrap interval of `change`, resampling learners (deterministic); null below `minSampleSize`',
    nullable: true,
    type: [Number],
    example: [-4.5, 18.2],
  })
  changeCi!: [number, number] | null;

  @ApiProperty({
    description: 'Learners whose named "rose" share beat their unnamed one',
  })
  up!: number;

  @ApiProperty({
    description:
      'Learners whose named "rose" share was below their unnamed one',
  })
  down!: number;

  @ApiProperty({ description: 'Learners with the two shares equal' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down (ties dropped); null below `minSampleSize` or with nothing to test',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description:
      'True only when `changeCi` excludes zero. Always false below `minSampleSize`',
  })
  detectable!: boolean;
}

export class FeedbackUptakePooledDto {
  @ApiProperty({
    type: FeedbackUptakeArmDto,
    description:
      "Every skill a window's debriefs named; each learner collapsed to one share across all their named observations",
  })
  named!: FeedbackUptakeArmDto;

  @ApiProperty({
    type: FeedbackUptakeArmDto,
    description:
      'Every skill assessable on both sides that no debrief in the window named; one share per learner',
  })
  unnamed!: FeedbackUptakeArmDto;

  @ApiProperty({
    type: FeedbackUptakeDifferenceDto,
    description:
      'The headline: named − unnamed "rose" share within learner. Pools skills with different base rates — read it beside `skills`',
  })
  difference!: FeedbackUptakeDifferenceDto;
}

export class FeedbackUptakeSkillDto {
  @ApiProperty({ description: 'Rubric skill key (FHS_RUBRIC)' })
  skill!: string;

  @ApiProperty({ description: "The rubric's own name for the skill" })
  name!: string;

  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;

  @ApiProperty({ type: FeedbackUptakeArmDto })
  named!: FeedbackUptakeArmDto;

  @ApiProperty({ type: FeedbackUptakeArmDto })
  unnamed!: FeedbackUptakeArmDto;

  @ApiProperty({ type: FeedbackUptakeDifferenceDto })
  difference!: FeedbackUptakeDifferenceDto;
}

/** How far the mapping and the pairing have got, so a thin chart can say why. */
export class FeedbackUptakeCoverageDto {
  @ApiProperty({
    description:
      'Sessions the mapping covers, in scope: completed, settled, countable, outside test orgs, a debrief with at least one improvement, of a learner with a scored cut',
  })
  debriefedSessions!: number;

  @ApiProperty({
    description:
      'Of those, mapped under this `mapperVersion` (each improvement filed under a skill or none)',
  })
  mappedSessions!: number;

  @ApiProperty({
    description:
      'Of those, skipped with no model call (no improvement with any text, or a malformed list). Final',
  })
  skippedSessions!: number;

  @ApiProperty({
    description:
      'Of those, whose latest mapping attempt failed (retried hourly up to 3 attempts, then left for a human)',
  })
  failedSessions!: number;

  @ApiProperty({
    description:
      'Of those, not yet attempted — waiting for the scheduler, or the scheduler is off in this environment',
  })
  pendingSessions!: number;

  @ApiProperty({
    description: 'Improvements across the mapped sessions in scope',
  })
  improvements!: number;

  @ApiProperty({
    description:
      'Of those, filed under no skill (the rubric does not cover it, or too vague)',
  })
  improvementsWithoutSkill!: number;

  @ApiProperty({
    description:
      'Mapped sessions with a scored cut both before and after them (see the pairing rule)',
  })
  sessionsPaired!: number;

  @ApiProperty({
    description:
      'Distinct (learner, before cut, after cut) windows those sessions fall into — the unit of observation',
  })
  windows!: number;

  @ApiProperty({ description: 'Learners with at least one window' })
  learnersPaired!: number;

  @ApiProperty({
    description:
      '(window, skill) pairs where a debrief named the skill but it was not assessable in both cuts — named, but unmeasurable',
  })
  namedNotAssessable!: number;
}

export class FeedbackUptakeScopingDto {
  @ApiProperty({
    description:
      'Tenant the response was narrowed to; null = every non-test org',
    nullable: true,
    type: String,
  })
  tenantId!: string | null;

  @ApiProperty({
    description: 'How the org filter reaches each part of the response',
  })
  note!: string;
}

export class FeedbackUptakeResponseDto {
  @ApiProperty({
    description:
      'The one rubric version every level here comes from (ruler R1)',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'The one feedback → skill mapper version every named/unnamed split comes from',
  })
  mapperVersion!: string;

  @ApiProperty({
    description:
      'Shares and differences below this many learners are withheld (null)',
  })
  minSampleSize!: number;

  @ApiProperty({ type: FeedbackUptakeCoverageDto })
  coverage!: FeedbackUptakeCoverageDto;

  @ApiProperty({ type: FeedbackUptakePooledDto })
  pooled!: FeedbackUptakePooledDto;

  @ApiProperty({
    type: [FeedbackUptakeSkillDto],
    description:
      'All 14 rubric skills in rubric order, whether or not any debrief named them — a skill no debrief names shows its learner counts at zero',
  })
  skills!: FeedbackUptakeSkillDto[];

  @ApiProperty({
    description:
      'The reading caveat, for the card: observational, and regression to the mean',
  })
  caveat!: string;

  @ApiProperty({ type: FoundationalSkillsProvenanceDto })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ type: FeedbackUptakeScopingDto })
  scoping!: FeedbackUptakeScopingDto;

  @ApiProperty()
  computedAt!: string;
}
