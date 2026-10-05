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
  CourseImpactReferenceDto,
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
// The people floor, for medians of durations and counts rather than of scores.
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import { median } from '../util/curriculum.util';
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
  /** Floor for the per-course medians (people, not scores). Defaults to MIN_COHORT_SIZE. */
  cohortFloor?: number;
}

const MS_PER_DAY = 86_400_000;
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Group slices by learner, each list oldest first (by when the slice closed). */
function cutsByLearner(
  cuts: readonly CourseImpactCutRow[],
): Map<number, CourseImpactCutRow[]> {
  const byUser = new Map<number, CourseImpactCutRow[]>();
  for (const cut of cuts) {
    const list = byUser.get(cut.userId);
    if (list) list.push(cut);
    else byUser.set(cut.userId, [cut]);
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  }
  return byUser;
}

/** One paired learner-course: their sides and where those sit in their own practice. */
export interface PairedEnrollment {
  userId: number;
  trackId: string;
  completedAt: Date;
  sides: CourseSides;
  /** 1-based position of the last before-slice in the learner's ordered slices. */
  lastBeforePosition: number;
  /** 1-based position of the first after-slice. */
  firstAfterPosition: number;
}

/**
 * Where a paired learner's sides sit in their own ordered slice list (1 =
 * their first scored slice). `userCuts` must be the same list the sides were
 * drawn from.
 */
export function sidePositions(
  userCuts: readonly CourseImpactCutRow[],
  sides: CourseSides,
): { lastBeforePosition: number; firstAfterPosition: number } | null {
  if (!sides.before.length || !sides.after.length) return null;
  const last = userCuts.indexOf(sides.before[sides.before.length - 1]);
  const first = userCuts.indexOf(sides.after[0]);
  if (last < 0 || first < 0) return null;
  return { lastBeforePosition: last + 1, firstAfterPosition: first + 1 };
}

/**
 * Each paired learner ONCE: at the earliest-finished course for which they
 * have slices on both sides (ties broken by course id, so the choice is
 * stable). A learner who finished two courses would otherwise count twice and
 * the interval would be over enrolments, not people.
 */
export function pooledLearners(
  paired: readonly PairedEnrollment[],
): PairedEnrollment[] {
  const chosen = new Map<number, PairedEnrollment>();
  for (const p of paired) {
    const current = chosen.get(p.userId);
    if (
      !current ||
      p.completedAt.getTime() < current.completedAt.getTime() ||
      (p.completedAt.getTime() === current.completedAt.getTime() &&
        p.trackId < current.trackId)
    ) {
      chosen.set(p.userId, p);
    }
  }
  return [...chosen.values()];
}

const compositeMean = (list: readonly CourseImpactCutRow[]): number | null =>
  list.length ? mean(list.map((c) => c.composite)) : null;

/**
 * The free-practice reference (see CourseImpactReferenceDto): learners with
 * no enrollment, read at the pooled course learners' median slice positions.
 *
 * k = median position of the pooled learners' last before-slice, g = median
 * gap to their first after-slice, both rounded to a whole slice (halves up).
 * A free-practice learner with at least k + g + window − 1 slices contributes
 * before = mean of positions max(1, k − window + 1)…k and after = mean of
 * positions k + g … k + g + window − 1.
 */
export function freePracticeReference(
  pooled: readonly PairedEnrollment[],
  freePracticeCuts: readonly CourseImpactCutRow[],
  window: number,
  floor: number,
): CourseImpactReferenceDto {
  const byUser = cutsByLearner(freePracticeCuts);
  const midStart = median(pooled.map((p) => p.lastBeforePosition));
  const midGap = median(
    pooled.map((p) => p.firstAfterPosition - p.lastBeforePosition),
  );
  if (midStart === null || midGap === null) {
    return {
      ...toDto(flooredPairedComparison([], [], floor)),
      candidates: byUser.size,
      matchedStartPosition: null,
      matchedGap: null,
    };
  }
  const k = Math.max(1, Math.round(midStart));
  const g = Math.max(1, Math.round(midGap));
  const before: number[] = [];
  const after: number[] = [];
  for (const list of byUser.values()) {
    if (list.length < k + g + window - 1) continue;
    // Positions are 1-based; slice() is 0-based and end-exclusive.
    const b = compositeMean(list.slice(Math.max(0, k - window), k));
    const a = compositeMean(list.slice(k + g - 1, k + g - 1 + window));
    if (b === null || a === null) continue;
    before.push(b);
    after.push(a);
  }
  return {
    ...toDto(flooredPairedComparison(before, after, floor)),
    candidates: byUser.size,
    matchedStartPosition: k,
    matchedGap: g,
  };
}

/**
 * Everything the response carries apart from its constants, from the three
 * reads. Pure, so the whole chart can be tested without a database.
 */
export function buildCourseImpact(
  enrollments: readonly CourseImpactEnrollmentRow[],
  cuts: readonly CourseImpactCutRow[],
  competencies: readonly CourseImpactCompetencyRow[],
  {
    window,
    floor,
    trackId,
    cohortFloor = MIN_COHORT_SIZE,
  }: CourseImpactBuildOptions,
  freePracticeCuts: readonly CourseImpactCutRow[] = [],
): Pick<
  CourseImpactResponseDto,
  'summary' | 'courses' | 'course' | 'pooled' | 'reference'
> {
  const cutsByUser = cutsByLearner(cuts);

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
  const pairedEnrollments: PairedEnrollment[] = [];
  // Filled in once every course is built — the reference needs all of them.
  const courses: Omit<CourseImpactCourseDto, 'reference'>[] = [];
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

    const coursePaired: PairedEnrollment[] = [];
    completed.forEach((e, i) => {
      const positions = sidePositions(cutsByUser.get(e.userId) ?? [], sides[i]);
      if (!positions) return;
      coursePaired.push({
        userId: e.userId,
        trackId: id,
        completedAt: e.completedAt as Date,
        sides: sides[i],
        ...positions,
      });
    });
    pairedEnrollments.push(...coursePaired);

    const days = completed.map((e) =>
      Math.max(
        0,
        ((e.completedAt as Date).getTime() - (e.startedAt as Date).getTime()) /
          MS_PER_DAY,
      ),
    );
    const between = coursePaired.map(
      (p) => p.firstAfterPosition - p.lastBeforePosition - 1,
    );
    const midDays = days.length >= cohortFloor ? median(days) : null;
    const midBetween = between.length >= cohortFloor ? median(between) : null;

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
      composite: compare(paired, compositeMean, floor),
      // Rubric order, so the same skill sits in the same place for every course.
      targetedSkills: FHS_RUBRIC.map((s) => s.key).filter((k) =>
        targeted.has(k),
      ),
      medianDaysToComplete: midDays === null ? null : round1(midDays),
      medianCutsBetween: midBetween === null ? null : round1(midBetween),
    });
  }

  const pooledSet = pooledLearners(pairedEnrollments);
  const pooled = compare(
    pooledSet.map((p) => p.sides),
    compositeMean,
    floor,
  );
  const reference = freePracticeReference(
    pooledSet,
    freePracticeCuts,
    window,
    floor,
  );

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

  return {
    summary,
    courses: courses.map((c) => ({ ...c, reference })),
    course,
    pooled,
    reference,
  };
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
    const [enrollments, cuts, competencies, freePracticeCuts] =
      await Promise.all([
        this.repository.getEnrollments(tenantId),
        this.repository.getScoredCuts(FHS_RUBRIC_VERSION, tenantId),
        this.repository.getCourseCompetencies(),
        this.repository.getFreePracticeCuts(FHS_RUBRIC_VERSION, tenantId),
      ]);

    const built = buildCourseImpact(
      enrollments,
      cuts,
      competencies,
      {
        window: COURSE_IMPACT_WINDOW_CUTS,
        floor: MIN_SCORE_SAMPLE_SIZE,
        trackId,
        cohortFloor: MIN_COHORT_SIZE,
      },
      freePracticeCuts,
    );
    const { matchedStartPosition: k, matchedGap: g } = built.reference;
    const referenceText =
      k === null || g === null
        ? 'No learner is paired yet, so there is no free-practice reference to match.'
        : `The grey reference is learners in the same scope with no course enrollment at all, read at ` +
          `the same point in their own practice: the mean of their slices ${Math.max(1, k - COURSE_IMPACT_WINDOW_CUTS + 1)}–${k} ` +
          `against slices ${k + g}–${k + g + COURSE_IMPACT_WINDOW_CUTS - 1} (oldest first), where ${k} is the course ` +
          `learners' median position of their last slice before the course and ${g} the median gap to their ` +
          `first slice after it. One pooled reference serves every course.`;

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minCohortSize: MIN_COHORT_SIZE,
      scoreDomain: [1, 4],
      windowCuts: COURSE_IMPACT_WINDOW_CUTS,
      ...built,
      provenance:
        `Each learner's roleplay speech is cut into ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character ` +
        `slices and every slice is scored 1–4 by ${FHS_JUDGE_MODEL} on the fixed foundational helping skills ` +
        `rubric, whatever the scenario. Before = the learner's last ${COURSE_IMPACT_WINDOW_CUTS} slices ` +
        `that closed before they started the course; after = their first ${COURSE_IMPACT_WINDOW_CUTS} made ` +
        `wholly after they finished it. Change is each learner against themselves, with a 95% bootstrap ` +
        `interval; averages over fewer than ${MIN_SCORE_SAMPLE_SIZE} learners are withheld. The pooled row counts ` +
        `each learner once, at the earliest course they finished with practice on both sides. ${referenceText} ` +
        `Not a controlled comparison: learners also practise outside the course, and people who finish courses ` +
        `also practise more, so a change is associated with the course, not caused by it. AI judge not yet ` +
        `checked against human raters; rubric version ${FHS_RUBRIC_VERSION}; test organisations excluded.`,
      computedAt: new Date().toISOString(),
    };
  }
}
