import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';
import {
  COMPETENCY_SCORE_UNAVAILABLE,
  CompetencyScoreUnavailable,
} from '../util/competency-map.util';

/**
 * Competency map — GET /v1/analytics/competency-map (Highlights → Skill
 * growth, AAQ-048).
 *
 * Practice VOLUME per competency (completed sessions on scenarios carrying the
 * tag — unchanged) against a learner SCORE on the foundational helping skills
 * ruler (R1): for the rubric skill the tag names, the mean level (1–4)
 * learners reached on that skill, over scored 5,000-character slices of their
 * own speech practised wholly on one scenario carrying the tag, counting only
 * slices that gave the skill an opportunity. AI-judged against a fixed rubric,
 * pinned to `rubricVersion`, not yet validated against trained human raters.
 *
 * **The score changed in 2026-10.** Before then `medianScore` was the median of
 * the LLM judge's 0–100 score of the AI ACTOR over the competency's sessions —
 * a measure of the roleplay character, not the learner. Keys the released
 * admin build reads are kept (`medianScore`, `evaluatedSessions`, `belowFloor`)
 * with their meaning restated below; new clients read `score`, `scoredCuts`
 * and `scoreUnavailable`.
 *
 * Takes NO window params: a per-competency mean needs a sample, and a dozen
 * competencies times a 30-day window leaves nearly every cell below the floor.
 */
export class CompetencyMapQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). Sessions are scoped by their ' +
      'tenant and cuts by theirs; the competencies and scenarios they point at ' +
      'are platform objects.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One competency: how much it is practised, and how the learners do at it. */
export class CompetencyMapRowDto {
  @ApiProperty({ description: 'Competency uuid' })
  competencyId!: string;

  @ApiProperty({
    description:
      'Competency name, falling back to the raw id when the competency row has ' +
      'been deleted — an unresolvable tag stays visible under its id rather ' +
      'than dropping its practice volume out of the map.',
  })
  name!: string;

  @ApiProperty({
    description:
      'Completed sessions on scenarios tagged with this competency — the volume ' +
      'axis, unchanged. Counts every completed countable session, scored or not.',
  })
  completedSessions!: number;

  @ApiProperty({
    description: 'Distinct learners who practised this competency',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Distinct scenarios tagged with this competency that have actually been ' +
      'played. Not the number that exist: 30 scenarios of which 2 are ever ' +
      'picked is a content-discovery problem, not a content-supply one.',
  })
  scenarios!: number;

  @ApiProperty({
    description:
      'The foundational helping skills rubric key this competency names ' +
      '(exact-name table `COURSE_IMPACT_COMPETENCY_SKILLS`), or null when it ' +
      'has none: Non-Verbal Communication (not visible in a transcript), ' +
      'Linking Emotions, Thoughts & Behaviours (a different skill from the ' +
      'rubric’s `functioning`), and every custom competency.',
    nullable: true,
    type: String,
    example: 'empathy',
  })
  skill!: string | null;

  @ApiProperty({
    description: 'The rubric’s display name for `skill`; null with no skill.',
    nullable: true,
    type: String,
  })
  skillName!: string | null;

  @ApiProperty({
    description:
      'Mean level (1–4, 2 dp) of `skill` over `scoredCuts` — single-scenario ' +
      'scored cuts on scenarios carrying this tag that gave the skill an ' +
      'opportunity. Null with `scoreUnavailable` set when there is no rubric ' +
      'skill or fewer than `minSampleSize` such cuts. A mean over cuts: ' +
      '`scoreLearners` says how many people they came from.',
    nullable: true,
    type: Number,
  })
  score!: number | null;

  @ApiProperty({
    description:
      'Single-scenario scored cuts on scenarios carrying this tag, whether or ' +
      'not they gave the skill an opportunity. `scoredCuts / taggedCuts` is how ' +
      'often this content actually elicits the skill. 0 with no rubric skill.',
  })
  taggedCuts!: number;

  @ApiProperty({
    description:
      'Of `taggedCuts`, those whose `skillLevels` holds `skill` — the n behind ' +
      '`score`. Always returned.',
  })
  scoredCuts!: number;

  @ApiProperty({
    description: 'Distinct learners behind `scoredCuts`.',
  })
  scoreLearners!: number;

  @ApiProperty({
    description:
      "Why `score` is null: 'noRubricSkill' (the tag names no rubric skill — " +
      "volume only, not a thin sample) or 'tooFewCuts' (`scoredCuts` below " +
      '`minSampleSize`). Null when a score is present.',
    enum: [...COMPETENCY_SCORE_UNAVAILABLE],
    nullable: true,
  })
  scoreUnavailable!: CompetencyScoreUnavailable | null;

  @ApiProperty({
    description:
      'DEPRECATED alias of `score`, kept so the released admin build still ' +
      'plots: since 2026-10 it is the MEAN foundational-skill level (1–4), not ' +
      'a median, and not the AI actor’s 0–100 judge score it used to be.',
    nullable: true,
    type: Number,
  })
  medianScore!: number | null;

  @ApiProperty({
    description:
      'DEPRECATED alias of `scoredCuts` (cuts, not sessions, since 2026-10), ' +
      'kept for the released client’s "n = X · need 20" label.',
  })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      "`scoreUnavailable === 'tooFewCuts'`: a thin sample, as opposed to a " +
      'competency with no rubric skill (which is not "below" anything).',
  })
  belowFloor!: boolean;
}

/** Practice the map cannot attribute to any competency. */
export class CompetencyMapUnattributedDto {
  @ApiProperty({
    description: 'Completed sessions whose scenario carries no competency tag',
  })
  completedSessions!: number;

  @ApiProperty({
    description:
      'Single-scenario scored cuts whose scenario carries no competency tag ' +
      '(or has since been deleted).',
  })
  scoredCuts!: number;

  @ApiProperty({
    description: 'DEPRECATED alias of `scoredCuts` (cuts, not sessions).',
  })
  evaluatedSessions!: number;

  @ApiProperty({
    description: 'Display label for the unattributed slice',
    example: 'No competency tagged',
  })
  label!: string;
}

/** Whole-platform totals behind the map. */
export class CompetencyMapSummaryDto {
  @ApiProperty({ description: 'Competencies with at least one played session' })
  competencies!: number;

  @ApiProperty({
    description:
      'DISTINCT completed sessions in scope, attributed or not. NOT the sum of ' +
      '`competencies[].completedSessions` — a session on a multi-competency ' +
      'scenario is counted once here and once per competency there.',
  })
  completedSessions!: number;

  @ApiProperty({
    description:
      'DEPRECATED alias of `cutAttribution.singleScenarioCuts` — the pool every ' +
      'score is drawn from (cuts, not sessions, since 2026-10).',
  })
  evaluatedSessions!: number;
}

/** How much of the learner ruler the scores can use. */
export class CompetencyMapCutAttributionDto {
  @ApiProperty({
    description:
      'Scored cuts in scope (rubric `rubricVersion`, test organisations excluded).',
  })
  scoredCuts!: number;

  @ApiProperty({
    description:
      'Of those, cuts whose every session ran the same scenario — the only cuts ' +
      'a scenario’s tags can be credited with. A cut spanning scenarios has no ' +
      'per-scenario skill score to split.',
  })
  singleScenarioCuts!: number;

  @ApiProperty({
    description:
      '`singleScenarioCuts / scoredCuts × 100` (1 dp): how much of the measured ' +
      'practice the map can attribute. Null below `minSampleSize` scored cuts.',
    nullable: true,
    type: Number,
  })
  singleScenarioPct!: number | null;

  @ApiProperty({
    description:
      'Single-scenario cuts whose scenario carries no tag (or was deleted).',
  })
  untaggedCuts!: number;
}

/** Where a number came from — shown on the card. */
export class CompetencyMapProvenanceDto {
  @ApiProperty({ description: 'Both axes and the ruler (R1) behind the score' })
  derivation!: string;

  @ApiProperty({
    description:
      'Caveats: single-scenario attribution, opportunity gating, AI judge not ' +
      'validated against human raters, and the 2026-10 change of score.',
  })
  note!: string;
}

/**
 * Which competencies are heavily practised, and how do learners do at them?
 *
 * Practice volume against the learners' own level on the skill the tag names,
 * so the quadrants are decisions: high volume + low level is where content
 * work pays off now, low volume is a coverage gap. A competency with no rubric
 * skill keeps its volume and has no score.
 *
 * **Sessions can be counted more than once.** A scenario tagged with several
 * competencies is practice of each, so its sessions (and its single-scenario
 * cuts) contribute to EVERY tagged competency's row; the per-competency counts
 * can sum to more than `summary.completedSessions`.
 */
export class CompetencyMapResponseDto {
  @ApiProperty({
    description:
      'Competencies sorted by `completedSessions` descending (name as the ' +
      'tiebreak). Rows without a score are INCLUDED with `scoreUnavailable`.',
    type: [CompetencyMapRowDto],
  })
  competencies!: CompetencyMapRowDto[];

  @ApiProperty({
    description:
      'Practice whose scenario carries no competency at all. Reported rather ' +
      'than dropped: if a third of practice volume is untagged then the map ' +
      'covers two thirds of the platform.',
    type: CompetencyMapUnattributedDto,
  })
  unattributed!: CompetencyMapUnattributedDto;

  @ApiProperty({
    description:
      'Assessable cuts a score is stated from (and scored cuts the ' +
      'single-scenario share is stated from). Below it the score is null and ' +
      'the counts stay. Echoed so the client keeps no second copy.',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Fixed [min, max] for the score axis: the rubric’s 1–4 (was 0–100 until ' +
      '2026-10).',
    type: [Number],
    example: [1, 4],
  })
  scoreDomain!: [number, number];

  @ApiProperty({
    description: 'Rubric version every score was judged under; never pooled.',
    example: 'fhs-text-v1',
  })
  rubricVersion!: string;

  @ApiProperty({ type: CompetencyMapCutAttributionDto })
  cutAttribution!: CompetencyMapCutAttributionDto;

  @ApiProperty({ type: CompetencyMapSummaryDto })
  summary!: CompetencyMapSummaryDto;

  @ApiProperty({ type: CompetencyMapProvenanceDto })
  provenance!: CompetencyMapProvenanceDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'sessions and cuts both carry a tenant, and the competencies/scenarios ' +
      'they point at are platform objects rather than per-org data.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
