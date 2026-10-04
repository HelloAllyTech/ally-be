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
