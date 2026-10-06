import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { FoundationalSkillsProvenanceDto } from './foundational-skills-analytics.dto';
import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * Highlights → Curriculum, course effectiveness, part two:
 *
 *  - GET /v1/analytics/curriculum/progress-curve (AAQ-225, "Where in a course
 *    momentum dies"): AAQ-050 says which item FORMAT learners stop at; this
 *    says WHERE in each course. Ruler R10 (course progress).
 *  - GET /v1/analytics/curriculum/knowledge-vs-skill (AAQ-226, "Does knowing
 *    predict doing?"): do learners who score well on a course's quizzes also
 *    show the helping skills in roleplay? Rulers R5 (quiz first attempts) and
 *    R1 (helping-skills slices, pinned rubric).
 *
 * Both are ALL TIME by construction and take no range: an item position is
 * "the learner's Nth item in this course" and a slice is "their next 5,000
 * characters after enrolling", whenever those happened — a date window would
 * only measure who happened to be active inside it. Platform-wide unless
 * `tenantId` narrows them to one org, by the LEARNER's own org; test
 * organisations always excluded. Courses: ACTIVE and ARCHIVED (the course
 * funnel set). "Live" means not soft-deleted (courses,
 * sections, items, enrolments, progress rows, attempts). These shapes are a
 * frontend contract.
 */

export class CourseProgressAnalyticsQueryDto {
  @ApiProperty({
    description:
      "Narrow to a single tenant (uuid or code), by the learner's own org " +
      '(users.tenant_id), as course impact does. Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/analytics/curriculum/progress-curve (AAQ-225)
// ─────────────────────────────────────────────────────────────────────────────

export class ProgressCurvePointDto {
  @ApiProperty({
    description:
      "1-based position in the course's ordered live items: sections by their `order`, then items by their `order` within the section — the order the engine unlocks them in",
  })
  position!: number;

  @ApiProperty({
    description:
      'x: position normalised to 0–100 — (position − 1) / (items − 1) × 100, so every course starts at 0 and ends at 100; a one-item course sits at 0. One decimal',
  })
  positionPct!: number;

  @ApiProperty({ description: 'track_items.id' })
  itemId!: string;

  @ApiProperty({ description: 'track_items.title (the authored title)' })
  itemTitle!: string;

  @ApiProperty({
    description: 'track_items.type (ROLEPLAY, QUIZ, ARTICLE, VIDEO, …)',
  })
  itemType!: string;

  @ApiProperty({
    description:
      'Started enrolments that reached this item: their furthest non-LOCKED progress row is at or beyond it, or they finished the course. Sequential unlock means reached = UNLOCKED, not opened. Counted on the furthest item so the curve can only fall (an item inserted behind a learner after they passed it does not make the line dip)',
  })
  reached!: number;

  @ApiProperty({
    description:
      'y: `reached` ÷ `startedEnrolments` × 100, one decimal. Only measurable courses carry points, so this is never withheld once present; null only on a zero denominator',
    nullable: true,
    type: Number,
  })
  reachedPct!: number | null;

  @ApiProperty({
    description:
      'Started enrolments that OPENED this item (track_item_progress.startedAt set). The gap from `reached` is learners who had it unlocked and never opened it — they stopped right after the previous item',
  })
  opened!: number;

  @ApiProperty({
    description: '`opened` ÷ `startedEnrolments` × 100, one decimal',
    nullable: true,
    type: Number,
  })
  openedPct!: number | null;
}

/** The biggest fall in a course's curve, for the expanded view's "momentum dies at". */
export class ProgressCurveDropDto {
  @ApiProperty({
    description:
      'Position of the item learners stopped at: they reached it but not the next step',
  })
  fromPosition!: number;

  @ApiProperty({ description: 'track_items.id of that item' })
  fromItemId!: string;

  @ApiProperty()
  fromItemTitle!: string;

  @ApiProperty({ description: 'track_items.type of that item' })
  fromItemType!: string;

  @ApiProperty({
    description:
      'Position of the next item; null when the step is from the last item to finishing the course (`toFinish`)',
    nullable: true,
    type: Number,
  })
  toPosition!: number | null;

  @ApiProperty({ nullable: true, type: String })
  toItemId!: string | null;

  @ApiProperty({
    description: 'Null when `toFinish`',
    nullable: true,
    type: String,
  })
  toItemTitle!: string | null;

  @ApiProperty({
    description:
      'True when the steepest step is the last item → finishing: learners reached the final item and never completed it',
  })
  toFinish!: boolean;

  @ApiProperty({
    description:
      'Started enrolments that reached `from` but not the next step (the next item, or finishing)',
  })
  lost!: number;

  @ApiProperty({
    description:
      'The fall in percentage points of started enrolments (`lost` ÷ `startedEnrolments` × 100), one decimal. Ties go to the earliest step',
  })
  dropPts!: number;
}

export class ProgressCurveCourseSummaryDto {
  @ApiProperty({ description: 'tracks.id' })
  trackId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description:
      'tracks.status: ACTIVE or ARCHIVED (DRAFT courses cannot be enrolled in and are left out)',
  })
  status!: string;

  @ApiProperty({
    description:
      'Live items in the course today (deleted items and items in deleted sections excluded)',
  })
  items!: number;

  @ApiProperty({ description: 'Live enrolments of learners in scope' })
  enrolments!: number;

  @ApiProperty({
    description:
      'Enrolments that STARTED — opened or completed at least one item, or finished (the course funnel AAQ-210 definition; track_enrollments.startedAt is written at enrolment, so it cannot be used). The denominator of every share',
  })
  startedEnrolments!: number;

  @ApiProperty({ description: 'Started enrolments that finished the course' })
  completed!: number;

  @ApiProperty({
    description:
      '`completed` ÷ `startedEnrolments` × 100, one decimal; null below `minSampleSize` started enrolments',
    nullable: true,
    type: Number,
  })
  completedPct!: number | null;

  @ApiProperty({
    type: ProgressCurveDropDto,
    nullable: true,
    description:
      'Where the curve falls furthest between consecutive steps (item → next item, or last item → finished). Null below `minSampleSize` or when no step loses anyone',
  })
  steepestDrop!: ProgressCurveDropDto | null;

  @ApiProperty({
    description:
      'True for the (up to) `chartCourses` measurable courses drawn as lines — those in `courses`',
  })
  inChart!: boolean;
}

export class ProgressCurveCourseDto extends ProgressCurveCourseSummaryDto {
  @ApiProperty({
    type: [ProgressCurvePointDto],
    description: 'One point per live item, in course order',
  })
  points!: ProgressCurvePointDto[];
}

export class ProgressCurveTotalsDto {
  @ApiProperty({
    description: 'Courses with at least one live enrolment in scope',
  })
  courses!: number;

  @ApiProperty({
    description:
      'Courses with at least `minSampleSize` started enrolments and a live item (`courses` + `others`)',
  })
  measurable!: number;

  @ApiProperty({ description: 'Live enrolments across every course' })
  enrolments!: number;

  @ApiProperty({ description: 'Started enrolments across every course' })
  startedEnrolments!: number;
}

export class ProgressCurveResponseDto {
  @ApiProperty({
    description:
      'A course needs this many started enrolments before any share is shown (MIN_SCORE_SAMPLE_SIZE)',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'How many measurable courses are drawn as lines',
  })
  chartCourses!: number;

  @ApiProperty({
    type: [ProgressCurveCourseDto],
    description:
      'The drawn courses: the measurable courses with the most started enrolments, up to `chartCourses`, most first, each with its points and `inChart: true`. Empty (never 404) when none is measurable',
  })
  courses!: ProgressCurveCourseDto[];

  @ApiProperty({
    type: [ProgressCurveCourseSummaryDto],
    description:
      'Measurable courses beyond the drawn ones, most started enrolments first: counts, completion and steepest drop, no points',
  })
  others!: ProgressCurveCourseSummaryDto[];

  @ApiProperty({
    type: [ProgressCurveCourseSummaryDto],
    description:
      'Courses with fewer than `minSampleSize` started enrolments (or no live items left): counts only — `completedPct` and `steepestDrop` are null',
  })
  belowFloor!: ProgressCurveCourseSummaryDto[];

  @ApiProperty({ type: ProgressCurveTotalsDto })
  totals!: ProgressCurveTotalsDto;

  @ApiProperty({
    type: FoundationalSkillsProvenanceDto,
    description:
      'R10 (course progress); `note` carries the card caveat: reached means unlocked, not opened',
  })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/analytics/curriculum/knowledge-vs-skill (AAQ-226)
// ─────────────────────────────────────────────────────────────────────────────

/** A Spearman rank correlation with the floor applied. */
export class RankCorrelationDto {
  @ApiProperty({
    description: 'Learner-course points it is computed over. Always present',
  })
  points!: number;

  @ApiProperty({
    description:
      'Distinct learners among those points (a learner in two courses is two points, one learner)',
  })
  learners!: number;

  @ApiProperty({
    description:
      "Spearman's rank correlation of quiz score (x) with helping-skills composite (y): Pearson r on average ranks, so ties are handled exactly. Two decimals; null below `minSampleSize` points or when either side does not vary",
    nullable: true,
    type: Number,
  })
  r!: number | null;

  @ApiProperty({
    description:
      '95% percentile bootstrap interval of `r`, resampling LEARNERS (every point of each drawn learner), deterministic seed. Null whenever `r` is',
    nullable: true,
    type: [Number],
    example: [-0.08, 0.31],
  })
  rCi!: [number, number] | null;

  @ApiProperty({
    description:
      'True only when `rCi` excludes zero. Always false below `minSampleSize`',
  })
  detectable!: boolean;
}

export class KnowledgeSkillPointDto {
  @ApiProperty({ description: 'tracks.id' })
  trackId!: string;

  @ApiProperty({
    description:
      'users.id — ids only, no names, as the other population charts carry',
  })
  learnerId!: number;

  @ApiProperty({
    description:
      "x: mean FIRST-attempt score (0–100, track_quiz_attempts.scorePct) over the course's live quizzes this learner has a scored first attempt on. The first attempt is the earliest live `attemptNumber = 1` attempt; a still-pending or ungraded (survey) first attempt leaves that quiz out rather than letting a retry stand in. One decimal",
  })
  quizScore!: number;

  @ApiProperty({
    description:
      'y: mean helping-skills composite (1–4) of the learner’s first `skillWindowCuts` scored slices whose first session ended after they enrolled — during and after the course. Two decimals',
  })
  skillScore!: number;

  @ApiProperty({ description: 'Quizzes averaged into `quizScore`' })
  quizzes!: number;

  @ApiProperty({
    description: 'Slices averaged into `skillScore` (1 to `skillWindowCuts`)',
  })
  slices!: number;
}

export class KnowledgeSkillCourseDto {
  @ApiProperty({ description: 'tracks.id' })
  trackId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description:
      'tracks.status: ACTIVE or ARCHIVED (DRAFT courses cannot be enrolled in and are left out)',
  })
  status!: string;

  @ApiProperty({ description: 'Live QUIZ items in the course today' })
  quizItems!: number;

  @ApiProperty({
    description:
      'Live enrolments of learners in scope (= points + missingQuiz + missingSkill)',
  })
  enrolments!: number;

  @ApiProperty({
    description:
      "Enrolments with no scored first attempt on any of the course's quizzes",
  })
  missingQuiz!: number;

  @ApiProperty({
    description:
      'Enrolments with a quiz score but no scored helping-skills slice made after enrolling',
  })
  missingSkill!: number;

  @ApiProperty({
    type: RankCorrelationDto,
    description:
      'This course alone. `r` is shown only when the course has at least `minSampleSize` points by itself',
  })
  correlation!: RankCorrelationDto;
}

export class KnowledgeSkillCoverageDto {
  @ApiProperty({
    description: 'Courses with a live quiz and a live enrolment in scope',
  })
  courses!: number;

  @ApiProperty({ description: 'Live enrolments in those courses' })
  enrolments!: number;

  @ApiProperty({ description: 'Plotted learner-course points' })
  points!: number;

  @ApiProperty({ description: 'Distinct learners among the points' })
  learners!: number;

  @ApiProperty({
    description: 'Enrolments with no scored first quiz attempt (not plotted)',
  })
  missingQuiz!: number;

  @ApiProperty({
    description:
      'Enrolments with a quiz score but no scored slice after enrolling (not plotted)',
  })
  missingSkill!: number;
}

export class KnowledgeVsSkillResponseDto {
  @ApiProperty({
    description: 'The one rubric version every composite here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'r and its interval are withheld below this many points (MIN_POINTS_FOR_CORRELATION = 30), overall and per course. Points are always listed',
  })
  minSampleSize!: number;

  @ApiProperty({
    type: [Number],
    example: [1, 4],
    description: 'y axis (helping-skills composite)',
  })
  scoreDomain!: [number, number];

  @ApiProperty({
    type: [Number],
    example: [0, 100],
    description: 'x axis (first-attempt quiz score)',
  })
  quizScoreDomain!: [number, number];

  @ApiProperty({
    description:
      'Most slices averaged for a learner’s skill score: the first this-many made after enrolling (COURSE_IMPACT_WINDOW_CUTS × 2, covering during and after the course)',
  })
  skillWindowCuts!: number;

  @ApiProperty({ type: KnowledgeSkillCoverageDto })
  coverage!: KnowledgeSkillCoverageDto;

  @ApiProperty({
    type: RankCorrelationDto,
    description:
      'Every point pooled across courses. Pooling mixes quizzes of different difficulty, so a per-course `r` (where a course reaches the floor) is the cleaner read',
  })
  overall!: RankCorrelationDto;

  @ApiProperty({
    type: [KnowledgeSkillCourseDto],
    description:
      'Every course with a live quiz and an enrolment in scope, most points first. Empty (never 404) when there are none',
  })
  courses!: KnowledgeSkillCourseDto[];

  @ApiProperty({
    type: [KnowledgeSkillPointDto],
    description:
      'Every plotted learner-course point, ordered by course then learner. No sample floor on the points themselves; the fitted line and r wait for `minSampleSize`',
  })
  points!: KnowledgeSkillPointDto[];

  @ApiProperty({
    type: FoundationalSkillsProvenanceDto,
    description:
      'R5 × R1; `note` carries the card caveat: both measures are noisy, so a weak r is expected and still informative',
  })
  provenance!: FoundationalSkillsProvenanceDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty()
  computedAt!: string;
}
