import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  COURSE_IMPACT_COMPETENCY_SKILLS,
  COURSE_IMPACT_WINDOW_CUTS,
} from '../constants/course-impact.constants';
import {
  CourseImpactComparisonDto,
  CourseImpactCourseDto,
  CourseImpactDetailDto,
  CourseImpactQueryDto,
  CourseImpactResponseDto,
  CourseImpactSummaryDto,
} from '../dto/course-impact.dto';
import {
  CourseImpactAnalyticsRepository,
  CourseImpactCompetencyRow,
  CourseImpactCutRow,
  CourseImpactEnrollmentRow,
} from '../repository/course-impact-analytics.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  FlooredPairedComparison,
  flooredPairedComparison,
} from '../util/paired-stats.util';

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** A learner's slices either side of one course. */
export interface CourseSides {
  before: CourseImpactCutRow[];
  after: CourseImpactCutRow[];
}

/**
 * The windowing rule, in one place so no client can apply it differently.
 *
 * - **Before**: the last `window` slices that CLOSED before the learner started
 *   the course — every word in them predates it.
 * - **After**: the first `window` slices whose FIRST session ended after the
 *   learner finished — every session in them ended after it. A slice that
 *   straddles the finish (part course, part after) belongs to neither side.
 *   Learners who have not finished have no after.
 *
 * `cuts` must be one learner's, oldest first.
 */
export function courseSides(
  startedAt: Date | null,
  completedAt: Date | null,
  cuts: readonly CourseImpactCutRow[],
  window: number,
): CourseSides {
  if (!startedAt) return { before: [], after: [] };
  const start = startedAt.getTime();
  const before = cuts
    .filter((c) => c.closedAt.getTime() < start)
    .slice(-window);
  if (!completedAt) return { before, after: [] };
  const end = completedAt.getTime();
  const after = cuts
    .filter((c) => c.firstEndedAt !== null && c.firstEndedAt.getTime() > end)
    .slice(0, window);
  return { before, after };
}

const hasLevel = (levels: Record<string, number>, skill: string): boolean =>
  Object.prototype.hasOwnProperty.call(levels, skill) &&
  Number.isFinite(Number(levels[skill]));

/** A learner's mean level on one skill over the slices that could show it; null when none could. */
function skillMean(
  cuts: readonly CourseImpactCutRow[],
  skill: string,
): number | null {
  const levels = cuts
    .filter((c) => hasLevel(c.levels, skill))
    .map((c) => Number(c.levels[skill]));
  return levels.length ? mean(levels) : null;
}

/** Share of a learner's slices with any unhelpful behaviour; null when none was coded either way. */
function unhelpfulShare(cuts: readonly CourseImpactCutRow[]): number | null {
  const coded = cuts.filter((c) => c.unhelpful !== null);
  return coded.length
    ? coded.filter((c) => c.unhelpful).length / coded.length
    : null;
}

/** Pair up the learners for whom `measure` is defined on both sides. */
function compare(
  paired: readonly CourseSides[],
  measure: (cuts: readonly CourseImpactCutRow[]) => number | null,
  floor: number,
): CourseImpactComparisonDto {
  const before: number[] = [];
  const after: number[] = [];
  for (const sides of paired) {
    const b = measure(sides.before);
    const a = measure(sides.after);
    if (b === null || a === null) continue;
    before.push(b);
    after.push(a);
  }
  return toDto(flooredPairedComparison(before, after, floor));
}

const toDto = (c: FlooredPairedComparison): CourseImpactComparisonDto => ({
  learners: c.n,
  beforeAvg: c.beforeAvg,
  afterAvg: c.afterAvg,
  change: c.change,
  changeCi: c.changeCi,
  up: c.up,
  down: c.down,
  tied: c.tied,
  signP: c.signP,
  detectable: c.detectable,
});

export interface CourseImpactBuildOptions {
  window: number;
  floor: number;
  trackId?: string;
}

/**
 * Everything the response carries apart from its constants, from the three
 * reads. Pure, so the whole chart can be tested without a database.
 */
export function buildCourseImpact(
  enrollments: readonly CourseImpactEnrollmentRow[],
  cuts: readonly CourseImpactCutRow[],
  competencies: readonly CourseImpactCompetencyRow[],
  { window, floor, trackId }: CourseImpactBuildOptions,
): Pick<CourseImpactResponseDto, 'summary' | 'courses' | 'course'> {
  const cutsByUser = new Map<number, CourseImpactCutRow[]>();
  for (const cut of cuts) {
    const list = cutsByUser.get(cut.userId);
    if (list) list.push(cut);
    else cutsByUser.set(cut.userId, [cut]);
  }
  for (const list of cutsByUser.values()) {
    list.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  }

  const competenciesByTrack = new Map<string, string[]>();
  for (const row of competencies) {
    const list = competenciesByTrack.get(row.trackId);
    if (list) list.push(row.name);
    else competenciesByTrack.set(row.trackId, [row.name]);
  }

  const byTrack = new Map<string, CourseImpactEnrollmentRow[]>();
  for (const e of enrollments) {
    const list = byTrack.get(e.trackId);
    if (list) list.push(e);
    else byTrack.set(e.trackId, [e]);
  }

  const pairedByTrack = new Map<string, CourseSides[]>();
  const courses: CourseImpactCourseDto[] = [];
  for (const [id, rows] of byTrack) {
    const started = rows.filter((e) => e.startedAt);
    const completed = started.filter((e) => e.completedAt);
    const sides = completed.map((e) =>
      courseSides(
        e.startedAt,
        e.completedAt,
        cutsByUser.get(e.userId) ?? [],
        window,
      ),
    );
    const withBaseline = sides.filter((s) => s.before.length > 0);
    const paired = withBaseline.filter((s) => s.after.length > 0);
    pairedByTrack.set(id, paired);

    const targeted = new Set(
      (competenciesByTrack.get(id) ?? [])
        .map((name) => COURSE_IMPACT_COMPETENCY_SKILLS[name])
        .filter((key): key is string => !!key),
    );

    courses.push({
      trackId: id,
      title: rows[0].title,
      status: rows[0].status,
      coverage: {
        enrolled: rows.length,
        started: started.length,
        completed: completed.length,
        withBaseline: withBaseline.length,
        paired: paired.length,
      },
      composite: compare(
        paired,
        (list) => (list.length ? mean(list.map((c) => c.composite)) : null),
        floor,
      ),
      // Rubric order, so the same skill sits in the same place for every course.
      targetedSkills: FHS_RUBRIC.map((s) => s.key).filter((k) =>
        targeted.has(k),
      ),
    });
  }

  courses.sort(
    (a, b) =>
      b.coverage.paired - a.coverage.paired ||
      b.coverage.enrolled - a.coverage.enrolled ||
      a.title.localeCompare(b.title) ||
      a.trackId.localeCompare(b.trackId),
  );

  const measurable = courses.filter((c) => c.composite.learners >= floor);
  const improved = measurable.filter(
    (c) => c.composite.detectable && (c.composite.change ?? 0) > 0,
  ).length;
  const declined = measurable.filter(
    (c) => c.composite.detectable && (c.composite.change ?? 0) < 0,
  ).length;
  const summary: CourseImpactSummaryDto = {
    courses: courses.length,
    measurable: measurable.length,
    improved,
    declined,
    unclear: measurable.length - improved - declined,
    pairedEnrollments: courses.reduce((n, c) => n + c.coverage.paired, 0),
  };

  let course: CourseImpactDetailDto | null = null;
  const chosen = trackId ? courses.find((c) => c.trackId === trackId) : null;
  if (chosen) {
    const paired = pairedByTrack.get(chosen.trackId) ?? [];
    const targeted = new Set(chosen.targetedSkills);
    course = {
      trackId: chosen.trackId,
      title: chosen.title,
      competencies: competenciesByTrack.get(chosen.trackId) ?? [],
      // Per skill, only the learners for whom the skill was assessable on BOTH
      // sides: an absent key means the practice gave no opportunity for it,
      // and counting that as a low score would invent a change.
      skills: FHS_RUBRIC.map((skill) => ({
        skill: skill.key,
        name: skill.name,
        targeted: targeted.has(skill.key),
        comparison: compare(
          paired,
          (list) => skillMean(list, skill.key),
          floor,
        ),
      })),
      unhelpful: compare(paired, unhelpfulShare, floor),
    };
  }

  return { summary, courses, course };
}

/**
 * Course impact (Highlights → Course impact): for each course, did its
 * learners do better on the foundational helping skills after the course than
 * before it, compared within each learner?
 *
 * With no enrollments it returns an empty `courses` and zero counts, never a
 * 404.
 */
@Injectable()
export class CourseImpactAnalyticsService {
  constructor(private readonly repository: CourseImpactAnalyticsRepository) {}

  async getCourseImpact(
    query: CourseImpactQueryDto = {},
  ): Promise<CourseImpactResponseDto> {
    const { tenantId, trackId } = query;
    const [enrollments, cuts, competencies] = await Promise.all([
      this.repository.getEnrollments(tenantId),
      this.repository.getScoredCuts(FHS_RUBRIC_VERSION, tenantId),
      this.repository.getCourseCompetencies(),
    ]);

    const built = buildCourseImpact(enrollments, cuts, competencies, {
      window: COURSE_IMPACT_WINDOW_CUTS,
      floor: MIN_SCORE_SAMPLE_SIZE,
      trackId,
    });

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: [1, 4],
      windowCuts: COURSE_IMPACT_WINDOW_CUTS,
      ...built,
      provenance:
        `Each learner's roleplay speech is cut into ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character ` +
        `slices and every slice is scored 1–4 by ${FHS_JUDGE_MODEL} on the fixed foundational helping skills ` +
        `rubric, whatever the scenario. Before = the learner's last ${COURSE_IMPACT_WINDOW_CUTS} slices ` +
        `that closed before they started the course; after = their first ${COURSE_IMPACT_WINDOW_CUTS} made ` +
        `wholly after they finished it. Change is each learner against themselves, with a 95% bootstrap ` +
        `interval; averages over fewer than ${MIN_SCORE_SAMPLE_SIZE} learners are withheld. Not a controlled ` +
        `comparison: learners also practise outside the course, so a change is what happened to its learners, ` +
        `not proof the course caused it. AI judge not yet checked against human raters; rubric version ` +
        `${FHS_RUBRIC_VERSION}; test organisations excluded.`,
      computedAt: new Date().toISOString(),
    };
  }
}
