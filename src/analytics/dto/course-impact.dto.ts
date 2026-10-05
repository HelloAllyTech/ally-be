import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * Course impact — GET /v1/analytics/course-impact.
 *
 * Per course: each learner's helping-skills score (1–4, one fixed rubric
 * whatever the scenario) from practice just BEFORE they started the course,
 * against practice made wholly AFTER they finished it, compared within the
 * learner. All-time; platform-wide unless `tenantId` narrows it to one org;
 * test organisations excluded; one rubric version per response. This shape is
 * a frontend contract.
 *
 * Beside the per-course rows: `pooled`, the same comparison over every paired
 * learner counted once, and `reference`, a free-practice comparison over the
 * same slice positions from learners who never enrolled. Observational
 * throughout — a course's change is associated with the course, not caused by
 * it: people who finish courses also practise more.
 */

export class CourseImpactQueryDto {
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

  @ApiProperty({
    description:
      'tracks.id. When set, `course` carries that course skill by skill. ' +
      'The course list is returned either way.',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  trackId?: string;
}

/** A paired before/after comparison, with the platform's sample floor applied. */
export class CourseImpactComparisonDto {
  @ApiProperty({
    description:
      'Learners in the comparison. Present whatever the averages do.',
  })
  learners!: number;

  @ApiProperty({
    description: 'Their average before the course; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  beforeAvg!: number | null;

  @ApiProperty({
    description:
      'The same learners’ average after the course; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  afterAvg!: number | null;

  @ApiProperty({
    description:
      'Mean of each learner’s own change (after − before); null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  change!: number | null;

  @ApiProperty({
    description:
      '95% paired bootstrap interval of `change` (deterministic); null below `minSampleSize`',
    nullable: true,
    type: [Number],
    example: [0.05, 0.31],
  })
  changeCi!: [number, number] | null;

  @ApiProperty({ description: 'Learners who went up' })
  up!: number;

  @ApiProperty({ description: 'Learners who went down' })
  down!: number;

  @ApiProperty({ description: 'Learners who did not move' })
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

/**
 * The free-practice reference (the grey whisker): what the same amount of
 * practice looked like for learners who never took a course.
 *
 * Learners in scope with NO live `track_enrollments` row at all, read at the
 * same point in their own practice as the course learners: with `k` =
 * {@link matchedStartPosition} and `g` = {@link matchedGap}, before = the mean
 * composite of their scored slices at positions `k − windowCuts + 1 … k`
 * (clamped at 1) and after = the mean of positions `k + g … k + g + windowCuts − 1`,
 * counting their slices oldest first. Only learners with at least
 * `k + g + windowCuts − 1` scored slices are compared. `k` and `g` come from the
 * pooled course learners (each learner once): the median position of their
 * last slice before the course, and the median gap from it to their first
 * slice after.
 *
 * One reference for the whole response, not one per course: at today's
 * learner numbers a per-course matched set would be a handful of people, so the
 * honest comparison is one free-practice whisker beside every course. It is a
 * reference, not a control — learners who choose to take courses differ from
 * those who do not.
 */
export class CourseImpactReferenceDto extends CourseImpactComparisonDto {
  @ApiProperty({
    description:
      'Free-practice learners in scope with at least one scored slice — the pool the compared set (`learners`) is drawn from',
  })
  candidates!: number;

  @ApiProperty({
    description:
      "k: median position (1 = a learner's first scored slice) of the pooled course learners' last slice before the course. Null when no course learner is paired",
    nullable: true,
    type: Number,
  })
  matchedStartPosition!: number | null;

  @ApiProperty({
    description:
      'g: median of (position of first slice after the course − position of last slice before it) over the pooled course learners. Null when no course learner is paired',
    nullable: true,
    type: Number,
  })
  matchedGap!: number | null;
}

/**
 * How many of a course's learners can be compared at all — the funnel from
 * enrolled to paired. Each step is a subset of the one before, so a thin
 * comparison can say where its learners dropped out of the measure.
 */
export class CourseImpactCoverageDto {
  @ApiProperty({ description: 'Enrollments (one per learner and course)' })
  enrolled!: number;

  @ApiProperty({ description: 'Enrolled learners who started the course' })
  started!: number;

  @ApiProperty({ description: 'Started learners who finished it' })
  completed!: number;

  @ApiProperty({
    description:
      'Finished learners with at least one scored slice closed before they started (a baseline)',
  })
  withBaseline!: number;

  @ApiProperty({
    description:
      'Of those, learners with at least one scored slice made wholly after they finished — the paired set',
  })
  paired!: number;
}

export class CourseImpactCourseDto {
  @ApiProperty({ description: 'tracks.id' })
  trackId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'tracks.status (DRAFT / PUBLISHED / …)' })
  status!: string;

  @ApiProperty({ type: CourseImpactCoverageDto })
  coverage!: CourseImpactCoverageDto;

  @ApiProperty({
    type: CourseImpactComparisonDto,
    description: 'Composite score (1–4), before vs after, over the paired set',
  })
  composite!: CourseImpactComparisonDto;

  @ApiProperty({
    type: [String],
    description:
      'Rubric skill keys the course’s roleplays assess (mapped from their competencies); empty when none map',
  })
  targetedSkills!: string[];

  @ApiProperty({
    type: CourseImpactReferenceDto,
    description:
      'The free-practice reference to draw beside this course. The SAME object as the top-level `reference` on every course — one pooled whisker is the honest comparison at today’s learner numbers (see CourseImpactReferenceDto)',
  })
  reference!: CourseImpactReferenceDto;

  @ApiProperty({
    description:
      'Median days from enrolling to finishing, over learners who finished; null below `minCohortSize` finishers',
    nullable: true,
    type: Number,
  })
  medianDaysToComplete!: number | null;

  @ApiProperty({
    description:
      'Median number of scored slices between a paired learner’s last slice before the course and their first after it (slices made during the course, or straddling its start or finish); null below `minCohortSize` paired learners',
    nullable: true,
    type: Number,
  })
  medianCutsBetween!: number | null;
}

export class CourseImpactSkillDto {
  @ApiProperty({ description: 'Stable rubric skill key (e.g. `verbal`)' })
  skill!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'True when one of the course’s roleplays assesses this skill',
  })
  targeted!: boolean;

  @ApiProperty({
    type: CourseImpactComparisonDto,
    description:
      'Level (1–4) before vs after, over paired learners for whom the skill was assessable on BOTH sides (absent means no opportunity, not a low score)',
  })
  comparison!: CourseImpactComparisonDto;
}

export class CourseImpactDetailDto {
  @ApiProperty({ description: 'tracks.id' })
  trackId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    type: [String],
    description:
      'Every competency the course’s roleplays assess, by name, whether or not it maps to a rubric skill',
  })
  competencies!: string[];

  @ApiProperty({ type: [CourseImpactSkillDto] })
  skills!: CourseImpactSkillDto[];

  @ApiProperty({
    type: CourseImpactComparisonDto,
    description:
      'Share of a learner’s slices (0–1) showing any unhelpful or potentially harmful behaviour, before vs after. Down is better',
  })
  unhelpful!: CourseImpactComparisonDto;
}

export class CourseImpactSummaryDto {
  @ApiProperty({ description: 'Courses with at least one enrollment' })
  courses!: number;

  @ApiProperty({
    description: 'Courses with at least `minSampleSize` paired learners',
  })
  measurable!: number;

  @ApiProperty({
    description: 'Measurable courses whose change interval sits above zero',
  })
  improved!: number;

  @ApiProperty({
    description: 'Measurable courses whose change interval sits below zero',
  })
  declined!: number;

  @ApiProperty({
    description: 'Measurable courses whose interval spans zero',
  })
  unclear!: number;

  @ApiProperty({
    description:
      'Paired learner-course comparisons across every course (a learner in two courses counts twice)',
  })
  pairedEnrollments!: number;
}

export class CourseImpactResponseDto {
  @ApiProperty({
    description: 'The one rubric version every number here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'Averages, intervals and tests below this many learners are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Per-course medians (`medianDaysToComplete`, `medianCutsBetween`) below this many learners are withheld',
  })
  minCohortSize!: number;

  @ApiProperty({ type: [Number], example: [1, 4] })
  scoreDomain!: [number, number];

  @ApiProperty({
    description:
      'Scored slices averaged on each side: the last this-many before the course, the first this-many after',
  })
  windowCuts!: number;

  @ApiProperty({ type: CourseImpactSummaryDto })
  summary!: CourseImpactSummaryDto;

  @ApiProperty({
    type: CourseImpactComparisonDto,
    description:
      'Composite (1–4) before vs after over every paired learner across all courses, each learner counted ONCE — at the earliest-finished course for which they have slices on both sides. Feeds the Effectiveness strip’s "Course lift" tile. Unlike `summary.pairedEnrollments`, a learner in two courses is one learner here',
  })
  pooled!: CourseImpactComparisonDto;

  @ApiProperty({
    type: CourseImpactReferenceDto,
    description:
      'The free-practice reference (grey whisker): learners with no course enrolment, read over the same slice positions as the pooled course learners. Also repeated on every course as `courses[].reference`',
  })
  reference!: CourseImpactReferenceDto;

  @ApiProperty({
    type: [CourseImpactCourseDto],
    description:
      'Every course with an enrollment, most paired learners first. Empty (never 404) when there are none',
  })
  courses!: CourseImpactCourseDto[];

  @ApiProperty({
    type: CourseImpactDetailDto,
    nullable: true,
    description:
      'The course named by `trackId`, skill by skill; null when no `trackId` was sent or it has no enrollments',
  })
  course!: CourseImpactDetailDto | null;

  @ApiProperty({
    description: 'How the numbers are made, for the card footer',
  })
  provenance!: string;

  @ApiProperty()
  computedAt!: string;
}
