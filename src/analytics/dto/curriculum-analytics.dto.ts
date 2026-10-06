import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Highlights → Curriculum: is the course content working?
 *
 *  - GET /v1/analytics/curriculum/course-funnel (AAQ-210) — of the learners who
 *    enrolled in each course in the window, how many started, reached half,
 *    finished, how long it took, and how many have stalled. Calendar window on
 *    the enrolment date (default 12 months).
 *  - GET /v1/analytics/curriculum/quiz-outcomes (AAQ-211, AAQ-212) — per
 *    quiz: pass on the first attempt, and first → best score among learners
 *    who tried again. Calendar window on the first attempt's submission.
 *  - GET /v1/analytics/curriculum/roleplay-gates (AAQ-213) — per course
 *    roleplay with a score gate: cleared first time, cleared later, stuck.
 *    All-time by construction (an "attempt number" is an ordinal, not a date).
 *
 * Every endpoint: platform-wide unless `tenantId` narrows it to one org (by
 * the LEARNER's own org); test organisations excluded; soft-deleted courses,
 * items, enrolments, progress rows and attempts excluded. Below a floor a
 * rate is null and its count still travels; a rate over nobody is null, never
 * 0. No learner identities, quiz text or answers are returned. This shape is
 * a frontend contract.
 */

/** How a number is made, for the card footer. */
export class CurriculumProvenanceDto {
  @ApiProperty({
    description:
      'Which ruler (plan R5 quiz attempts / R2 session score / R10 course progress) and how the numbers are derived',
  })
  derivation!: string;

  @ApiProperty({ description: 'The caveat the card must carry' })
  note!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Course funnel (AAQ-210): GET /v1/analytics/curriculum/course-funnel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Window on the enrolment's creation date. **Defaults to `range=12m`** (not the
 * shared 30d): a course takes weeks to finish, so a 30-day cohort is mostly
 * people who have not had time to. `range=all` is supported.
 */
export class CourseFunnelQueryDto extends AnalyticsWindowQueryDto {}

export class CourseFunnelCourseDto {
  @ApiProperty({ description: 'tracks.id' })
  trackId!: string;

  @ApiProperty({ description: 'Course title (author-written)' })
  title!: string;

  @ApiProperty({
    description:
      'tracks.status — ACTIVE or ARCHIVED (an archived course keeps its enrolled learners finishing it; DRAFT courses cannot be enrolled in and are never listed)',
  })
  status!: string;

  @ApiProperty({
    description: 'Items in the course today (tracks.totalItems)',
  })
  totalItems!: number;

  @ApiProperty({
    description: 'Enrolments created in the window (one per learner)',
  })
  enrolled!: number;

  @ApiProperty({
    description:
      'Of those, opened or completed at least one item. Not `track_enrollments.startedAt`: enrolling writes it immediately, so it cannot tell enrolled from started',
  })
  started!: number;

  @ApiProperty({
    description:
      'Of those, completed at least half the course’s items (completedItems ÷ totalItems ≥ 0.5, the tenant course-usage definition) or finished it. A subset of `started`',
  })
  halfway!: number;

  @ApiProperty({
    description:
      'Of those, finished the course (`completedAt` set). A subset of `halfway`',
  })
  completed!: number;

  @ApiProperty({
    description:
      'Started, not finished, and no course activity (`lastActivityAt`: enrolling, opening or completing an item) in the last `stalledAfterDays` days as of today. A subset of `started` − `completed`',
  })
  stalled!: number;

  @ApiProperty({
    description:
      '% of enrolled who started; null below `minCohortSize` enrolled',
    nullable: true,
    type: Number,
  })
  startedPct!: number | null;

  @ApiProperty({
    description:
      '% of enrolled who reached half; null below `minCohortSize` enrolled',
    nullable: true,
    type: Number,
  })
  halfwayPct!: number | null;

  @ApiProperty({
    description:
      '% of enrolled who finished; null below `minCohortSize` enrolled',
    nullable: true,
    type: Number,
  })
  completedPct!: number | null;

  @ApiProperty({
    description:
      '% of STARTED who have stalled; null below `minCohortSize` enrolled or when nobody started',
    nullable: true,
    type: Number,
  })
  stalledPct!: number | null;

  @ApiProperty({
    description:
      'Median days from enrolling to finishing, over finishers; null below `minCohortSize` finishers',
    nullable: true,
    type: Number,
  })
  medianDaysToComplete!: number | null;

  @ApiProperty({
    description:
      'Interquartile range [p25, p75] of days to finish, over finishers; null below `minCohortSize` finishers',
    nullable: true,
    type: [Number],
    example: [3.5, 12],
  })
  daysToCompleteIqr!: [number, number] | null;

  @ApiProperty({
    description:
      'True for the `chartCourses` courses with the most enrolments — the ones the bar chart draws. Every course is still listed for the table',
  })
  inChart!: boolean;
}

export class CourseFunnelTotalsDto {
  @ApiProperty({ description: 'Courses with an enrolment in the window' })
  courses!: number;

  @ApiProperty({ description: 'Enrolments in the window, all courses' })
  enrolled!: number;

  @ApiProperty() started!: number;
  @ApiProperty() halfway!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() stalled!: number;

  @ApiProperty({
    description:
      '% of all enrolments that finished; null below `minCohortSize` enrolments',
    nullable: true,
    type: Number,
  })
  completedPct!: number | null;

  @ApiProperty({
    description:
      '% of all started enrolments that have stalled; null below `minCohortSize` enrolments',
    nullable: true,
    type: Number,
  })
  stalledPct!: number | null;
}

export class CourseFunnelResponseDto {
  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description:
      'Rates and medians over fewer than this many learners are withheld (null)',
  })
  minCohortSize!: number;

  @ApiProperty({
    description:
      'Days without activity after which a started course is stalled',
  })
  stalledAfterDays!: number;

  @ApiProperty({
    description: 'How many courses (by enrolments) the chart draws',
  })
  chartCourses!: number;

  @ApiProperty({ type: CourseFunnelTotalsDto })
  totals!: CourseFunnelTotalsDto;

  @ApiProperty({
    type: [CourseFunnelCourseDto],
    description:
      'Every course with an enrolment in the window, most enrolments first. Empty (never 404) when there are none',
  })
  courses!: CourseFunnelCourseDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ type: CurriculumProvenanceDto })
  provenance!: CurriculumProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quiz outcomes (AAQ-211, AAQ-212): GET /v1/analytics/curriculum/quiz-outcomes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Window on the learner's FIRST attempt (`submittedAt` of their earliest
 * `attemptNumber = 1` attempt): the cohort is learners who first sat the quiz
 * in the window; their later attempts count up to the window's end.
 * **Defaults to `range=12m`**; `range=all` is supported.
 */
export class QuizOutcomesQueryDto extends AnalyticsWindowQueryDto {}

/** A question often wrong on the first attempt — by id, type and position, never text. */
export class QuizMissedQuestionDto {
  @ApiProperty({ description: 'The question’s id inside the quiz content' })
  questionId!: string;

  @ApiProperty({
    description:
      'Question type (mcq_single, mcq_multi, true_false, ordering, matching, fill_blank, open_ended); null when the question is no longer in the quiz',
    nullable: true,
    type: String,
  })
  type!: string | null;

  @ApiProperty({
    description:
      '1-based position in the quiz as it stands today; null when the question has since been removed',
    nullable: true,
    type: Number,
  })
  position!: number | null;

  @ApiProperty({
    description: 'First attempts that got this question wrong',
  })
  wrong!: number;

  @ApiProperty({
    description:
      'First attempts on which this question was graded (an ungraded or still-pending answer is neither right nor wrong)',
  })
  graded!: number;

  @ApiProperty({
    description:
      '% of `graded` that were wrong; null below `minSampleSize` graded',
    nullable: true,
    type: Number,
  })
  wrongPct!: number | null;
}

/** First vs best score (0–100) over the learners who tried a quiz again. */
export class QuizFirstToBestDto {
  @ApiProperty({
    description:
      'Learners with a scored first attempt AND at least one more scored attempt — the paired set',
  })
  learners!: number;

  @ApiProperty({
    description: 'Their mean first-attempt score; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  firstAvg!: number | null;

  @ApiProperty({
    description:
      'The same learners’ mean best score (highest scored attempt, first included); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  bestAvg!: number | null;

  @ApiProperty({
    description:
      'Mean of each learner’s own best − first, in points; null below `minSampleSize`. Never negative by construction: it says how much a retry recovers, not how much learners learned',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% paired bootstrap interval of `change` (deterministic); null below `minSampleSize`',
    nullable: true,
    type: [Number],
    example: [8.5, 21],
  })
  changeCi!: [number, number] | null;

  @ApiProperty({ description: 'Learners whose best beat their first' })
  up!: number;

  @ApiProperty({ description: 'Always 0 (best ≥ first); kept for shape' })
  down!: number;

  @ApiProperty({ description: 'Learners whose best was their first' })
  tied!: number;

  @ApiProperty({
    description:
      'Exact two-sided sign test on up vs down; null below `minSampleSize`. With `down` always 0 it only says whether retries moved anyone',
    nullable: true,
    type: Number,
  })
  signP!: number | null;

  @ApiProperty({
    description:
      'True only when `changeCi` excludes zero; always false below `minSampleSize`',
  })
  detectable!: boolean;
}

export class QuizOutcomeDto {
  @ApiProperty({ description: 'track_items.id of the QUIZ item' })
  trackItemId!: string;

  @ApiProperty({ description: 'Quiz title (author-written)' })
  title!: string;

  @ApiProperty({ description: 'tracks.id of its course' })
  trackId!: string;

  @ApiProperty({ description: 'Course title' })
  trackTitle!: string;

  @ApiProperty({
    description:
      'Learners whose first attempt was submitted in the window and is scored — the denominator for every rate on this row',
  })
  firstAttempts!: number;

  @ApiProperty({
    description:
      'Learners whose first attempt in the window is still awaiting grading, or scored nothing (a survey-only quiz). Not in `firstAttempts`',
  })
  unscoredFirstAttempts!: number;

  @ApiProperty({ description: 'First attempts that passed' })
  passedFirst!: number;

  @ApiProperty({
    description:
      '% of `firstAttempts` that passed; null below `minSampleSize` first attempts',
    nullable: true,
    type: Number,
  })
  passedFirstPct!: number | null;

  @ApiProperty({
    description:
      'Learners who made at least one more attempt after their first (scored or not)',
  })
  retried!: number;

  @ApiProperty({
    description:
      '% of `firstAttempts` who needed or chose a 2nd attempt; null below `minSampleSize` first attempts',
    nullable: true,
    type: Number,
  })
  retriedPct!: number | null;

  @ApiProperty({
    description:
      'Failed the first attempt and passed a later one (by the window’s end)',
  })
  passedLater!: number;

  @ApiProperty({
    description:
      'True when `firstAttempts` is below `minSampleSize`: every rate and change on the row is null and only counts are shown',
  })
  withheld!: boolean;

  @ApiProperty({ type: QuizFirstToBestDto })
  firstToBest!: QuizFirstToBestDto;

  @ApiProperty({
    type: [QuizMissedQuestionDto],
    description:
      'Expanded view: up to 5 questions most often wrong on the first attempt, by wrong count. Ids and types only — never question, option or answer text',
  })
  missedQuestions!: QuizMissedQuestionDto[];
}

export class QuizOutcomesSummaryDto {
  @ApiProperty({ description: 'Quizzes with a first attempt in the window' })
  quizzes!: number;

  @ApiProperty({
    description: 'Quizzes with at least `minSampleSize` scored first attempts',
  })
  measurable!: number;

  @ApiProperty({
    description:
      'Scored first attempts across all quizzes (a learner who sat two quizzes counts twice)',
  })
  firstAttempts!: number;
}

export class QuizOutcomesResponseDto {
  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    description: 'Rates and changes below this many learners are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({
    type: [Number],
    example: [0, 100],
    description: 'Fixed axis for scores',
  })
  scoreDomain!: [number, number];

  @ApiProperty({ type: QuizOutcomesSummaryDto })
  summary!: QuizOutcomesSummaryDto;

  @ApiProperty({
    type: [QuizOutcomeDto],
    description:
      'One row per quiz with a first attempt in the window, hardest first (lowest `passedFirstPct`); withheld rows after, most first attempts first. Empty (never 404) when there are none',
  })
  quizzes!: QuizOutcomeDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({
    type: CurriculumProvenanceDto,
    description:
      'The note carries the grader caveat: open-ended answers are LLM-graded (AI task `track-quiz-grading`), so a step in a quiz’s pass rate may be a grader change rather than a learner one',
  })
  provenance!: CurriculumProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Roleplay gates (AAQ-213): GET /v1/analytics/curriculum/roleplay-gates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All time by construction — the x-axis is "the learner's first, second, …
 * try at this gate", an ordinal, so there is no range. Org filter only.
 */
export class RoleplayGatesQueryDto {
  @ApiProperty({
    description:
      "Narrow to a single tenant (uuid or code), by the learner's own org. " +
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

export const ROLEPLAY_GATE_CALIBRATIONS = ['tooHard', 'tooEasy'] as const;

export class RoleplayGateDto {
  @ApiProperty({ description: 'track_items.id of the ROLEPLAY item' })
  trackItemId!: string;

  @ApiProperty({ description: 'Item title (author-written)' })
  title!: string;

  @ApiProperty({ description: 'tracks.id of its course' })
  trackId!: string;

  @ApiProperty({ description: 'Course title' })
  trackTitle!: string;

  @ApiProperty({
    description: 'scenarios.id the roleplay plays',
    nullable: true,
    type: Number,
  })
  scenarioId!: number | null;

  @ApiProperty({
    description:
      'The gate: completionCriteria.minScore, read at its CURRENT value (a gate edited since is applied to past attempts too). On the scenario’s own session-score scale',
  })
  minScore!: number;

  @ApiProperty({
    description:
      'Learner progress rows on this item with at least one linked countable session — the denominator',
  })
  progressRows!: number;

  @ApiProperty({
    description:
      'Completed, and the FIRST linked session’s score cleared the gate (`meetsMinimumScore`; a missing score reads as 0, as the gate read it)',
  })
  passedFirst!: number;

  @ApiProperty({
    description: 'Completed, but the first session did not clear the gate',
  })
  passedLater!: number;

  @ApiProperty({
    description:
      'Not completed, still unlocked, last linked session more than `stuckAfterDays` days ago',
  })
  stuck!: number;

  @ApiProperty({
    description: 'Not completed and not stuck (tried within `stuckAfterDays`)',
  })
  inProgress!: number;

  @ApiProperty({
    description: '% of `progressRows`; null below `minSampleSize` rows',
    nullable: true,
    type: Number,
  })
  passedFirstPct!: number | null;

  @ApiProperty({
    description: '% of `progressRows`; null below `minSampleSize` rows',
    nullable: true,
    type: Number,
  })
  passedLaterPct!: number | null;

  @ApiProperty({
    description: '% of `progressRows`; null below `minSampleSize` rows',
    nullable: true,
    type: Number,
  })
  stuckPct!: number | null;

  @ApiProperty({
    description: '% of `progressRows`; null below `minSampleSize` rows',
    nullable: true,
    type: Number,
  })
  inProgressPct!: number | null;

  @ApiProperty({
    description:
      'Median attempts to clear the gate, over completed rows: `track_item_progress.attemptCount`, the progression engine’s own counter of roleplay ends recorded while the item was incomplete (so it includes sessions too short to count, and stops at the passing one). Null below `minSampleSize` rows or `minCohortSize` completions',
    nullable: true,
    type: Number,
  })
  medianAttemptsToPass!: number | null;

  @ApiProperty({
    enum: ROLEPLAY_GATE_CALIBRATIONS,
    nullable: true,
    description:
      '`tooHard` when `passedFirstPct` is below `calibrationBand.tooHardBelowPct`, `tooEasy` above `calibrationBand.tooEasyAbovePct`; null inside the band or when withheld. A prompt to check the gate against the scenario, not a verdict',
  })
  calibration!: (typeof ROLEPLAY_GATE_CALIBRATIONS)[number] | null;

  @ApiProperty({
    description:
      'True below `minSampleSize` progress rows: shares, median and calibration are null; counts still shown',
  })
  withheld!: boolean;
}

export class RoleplayGateCalibrationBandDto {
  @ApiProperty({ example: 40 }) tooHardBelowPct!: number;
  @ApiProperty({ example: 95 }) tooEasyAbovePct!: number;
}

export class RoleplayGatesSummaryDto {
  @ApiProperty({
    description:
      'Gated roleplay items with at least one attempted progress row',
  })
  items!: number;

  @ApiProperty({
    description: 'Of those, items with at least `minSampleSize` progress rows',
  })
  measurable!: number;

  @ApiProperty({ description: 'Measurable items flagged `tooHard`' })
  tooHard!: number;

  @ApiProperty({ description: 'Measurable items flagged `tooEasy`' })
  tooEasy!: number;

  @ApiProperty({ description: 'Attempted progress rows across every item' })
  progressRows!: number;

  @ApiProperty({
    description:
      'Attempted roleplay items whose minScore is 0 or below — no gate (0 means "completing is enough"), so not listed',
  })
  ungatedItems!: number;
}

export class RoleplayGatesResponseDto {
  @ApiProperty({
    description:
      'Shares, medians and flags below this many progress rows are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'Median attempts are withheld below this many completions',
  })
  minCohortSize!: number;

  @ApiProperty({
    description:
      'Days since the last session after which an unfinished gate is stuck',
  })
  stuckAfterDays!: number;

  @ApiProperty({ type: RoleplayGateCalibrationBandDto })
  calibrationBand!: RoleplayGateCalibrationBandDto;

  @ApiProperty({ type: RoleplayGatesSummaryDto })
  summary!: RoleplayGatesSummaryDto;

  @ApiProperty({
    type: [RoleplayGateDto],
    description:
      'One row per gated roleplay item with an attempt, lowest first-time pass first; withheld rows after, most progress rows first. Empty (never 404) when there are none',
  })
  items!: RoleplayGateDto[];

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({
    type: CurriculumProvenanceDto,
    description:
      'The note carries the scale caveat: a session score (R2) is scenario-scaled, so a gate’s pass rate says whether the gate fits its scenario, not whether learners are skilled',
  })
  provenance!: CurriculumProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}
