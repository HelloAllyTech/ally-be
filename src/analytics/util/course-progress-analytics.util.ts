/**
 * Pure logic behind two Highlights → Curriculum charts, kept free of the
 * database so every rule is tested over fixtures:
 *
 *  - **Where in a course momentum dies** (AAQ-225): how far through each
 *    course's ordered items its started enrolments got — ruler R10 (course
 *    progress).
 *  - **Does knowing predict doing?** (AAQ-226): a learner's first-attempt quiz
 *    score in a course (R5) against their helping-skills composite in roleplay
 *    from the course onwards (R1), as a Spearman rank correlation with a
 *    learner-clustered bootstrap interval.
 *
 * Floors follow the analytics house rule: below a floor the number is null and
 * the count still travels, and a zero denominator is "no data", never 0.
 */
import { BOOTSTRAP_SEED } from './paired-stats.util';

// ─────────────────────────────────────────────────────────────────────────────
// Shared arithmetic
// ─────────────────────────────────────────────────────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** `num / den` as a percentage to one decimal; null on a zero denominator. */
const pct = (num: number, den: number): number | null =>
  den > 0 ? round1((num / den) * 100) : null;

// ─────────────────────────────────────────────────────────────────────────────
// Where in a course momentum dies (AAQ-225)
// ─────────────────────────────────────────────────────────────────────────────

/** Courses drawn as lines (most started enrolments first); the rest are listed. */
export const PROGRESS_CURVE_CHART_COURSES = 5;

/** One live item of a live course, as the repository reads it. */
export interface ProgressCurveItemRow {
  trackId: string;
  itemId: string;
  title: string;
  type: string;
  sectionId: string;
  sectionOrder: number;
  itemOrder: number;
}

/** One live enrolment with its progress rows summarised. */
export interface ProgressCurveEnrollmentRow {
  enrollmentId: string;
  trackId: string;
  title: string;
  status: string;
  completedAt: Date | null;
  completedItems: number;
  /** Any progress row opened (`track_item_progress.startedAt`) or COMPLETED. */
  openedAny: boolean;
  /** Items whose progress row is not LOCKED (UNLOCKED or COMPLETED). */
  reachedItemIds: string[];
  /** Items whose progress row has `startedAt` set: the learner opened it. */
  openedItemIds: string[];
}

/** An item on the chart: where it sits and how many got to it. */
export interface ProgressCurvePoint {
  position: number;
  positionPct: number;
  itemId: string;
  itemTitle: string;
  itemType: string;
  reached: number;
  reachedPct: number | null;
  opened: number;
  openedPct: number | null;
}

/** The biggest fall between two consecutive steps of one course. */
export interface ProgressCurveDrop {
  fromPosition: number;
  fromItemId: string;
  fromItemTitle: string;
  fromItemType: string;
  /** Null when the step is from the last item to finishing the course. */
  toPosition: number | null;
  toItemId: string | null;
  toItemTitle: string | null;
  toFinish: boolean;
  /** Started enrolments that reached `from` but not the next step. */
  lost: number;
  dropPts: number;
}

/** A course's counts, whether or not it is drawn. */
export interface ProgressCurveCourseSummary {
  trackId: string;
  title: string;
  status: string;
  items: number;
  enrolments: number;
  startedEnrolments: number;
  completed: number;
  completedPct: number | null;
  steepestDrop: ProgressCurveDrop | null;
  inChart: boolean;
}

export interface ProgressCurveCourse extends ProgressCurveCourseSummary {
  points: ProgressCurvePoint[];
}

export interface ProgressCurveBuild {
  courses: ProgressCurveCourse[];
  others: ProgressCurveCourseSummary[];
  belowFloor: ProgressCurveCourseSummary[];
  totals: {
    courses: number;
    measurable: number;
    enrolments: number;
    startedEnrolments: number;
  };
}

/**
 * Each course's live items in the order a learner meets them — the engine's
 * own walk (TrackProgressService.completeItem): sections by `order`, then
 * items by `order` within their section. Ids break ties so the order never
 * depends on how the rows came back.
 */
export function orderTrackItems(
  items: readonly ProgressCurveItemRow[],
): Map<string, ProgressCurveItemRow[]> {
  const byTrack = new Map<string, ProgressCurveItemRow[]>();
  for (const item of items) {
    const list = byTrack.get(item.trackId);
    if (list) list.push(item);
    else byTrack.set(item.trackId, [item]);
  }
  for (const list of byTrack.values()) {
    list.sort(
      (a, b) =>
        a.sectionOrder - b.sectionOrder ||
        a.sectionId.localeCompare(b.sectionId) ||
        a.itemOrder - b.itemOrder ||
        a.itemId.localeCompare(b.itemId),
    );
  }
  return byTrack;
}

/**
 * Started, exactly as the course funnel (AAQ-210) defines it: opened or
 * completed at least one item, or finished the course. NOT
 * `track_enrollments.startedAt` — enrolling writes that immediately, so it
 * cannot separate "enrolled" from "started".
 */
export function isStartedEnrollment(row: ProgressCurveEnrollmentRow): boolean {
  return row.completedAt !== null || row.openedAny || row.completedItems > 0;
}

/**
 * How far one enrolment got: the 1-based position of the furthest item it
 * reached (its progress row is not LOCKED), or every item when the course is
 * finished. 0 when it reached none of the course's current items.
 *
 * The furthest position, not the set of reached items, so the curve can only
 * fall: an item inserted behind a learner after they passed it has no row
 * (or a LOCKED one) for them, and counting it as "not reached" would make the
 * curve dip and recover. A finished enrolment reached everything, including
 * items added after it finished — it did not stop anywhere.
 */
export function furthestPosition(
  row: ProgressCurveEnrollmentRow,
  positionById: ReadonlyMap<string, number>,
  itemCount: number,
): number {
  if (row.completedAt !== null) return itemCount;
  let furthest = 0;
  for (const id of row.reachedItemIds) {
    const p = positionById.get(id);
    if (p !== undefined && p > furthest) furthest = p;
  }
  return furthest;
}

/**
 * Where a curve falls furthest between consecutive steps — item k to item
 * k + 1, and the last item to finishing. The fall is measured on the raw
 * shares and rounded once. Ties go to the earliest step. Null with no started
 * enrolments, or when no step loses anyone.
 */
export function steepestDrop(
  ordered: readonly ProgressCurveItemRow[],
  reachedCounts: readonly number[],
  completed: number,
  started: number,
): ProgressCurveDrop | null {
  if (started === 0 || ordered.length === 0) return null;
  let best: ProgressCurveDrop | null = null;
  for (let k = 0; k < ordered.length; k += 1) {
    const isLast = k === ordered.length - 1;
    const next = isLast ? completed : reachedCounts[k + 1];
    const lost = reachedCounts[k] - next;
    if (lost <= 0) continue;
    if (best && lost <= best.lost) continue;
    const to = isLast ? null : ordered[k + 1];
    best = {
      fromPosition: k + 1,
      fromItemId: ordered[k].itemId,
      fromItemTitle: ordered[k].title,
      fromItemType: ordered[k].type,
      toPosition: to ? k + 2 : null,
      toItemId: to ? to.itemId : null,
      toItemTitle: to ? to.title : null,
      toFinish: isLast,
      lost,
      dropPts: round1((lost / started) * 100),
    };
  }
  return best;
}

/**
 * x position of an item, 0–100: the first item at 0 and the last at 100, so
 * courses of any length start and end at the same place on one axis. A
 * one-item course sits at 0.
 */
export function positionPct(position: number, itemCount: number): number {
  return itemCount > 1 ? round1(((position - 1) / (itemCount - 1)) * 100) : 0;
}

export interface ProgressCurveOptions {
  /** Started enrolments a course needs before any share is shown. */
  floor: number;
  /** How many measurable courses are drawn. */
  chartCourses: number;
}

/**
 * Per course: how far its started enrolments got through its ordered live
 * items. A course is measurable with at least `floor` started enrolments and
 * at least one live item. Measurable courses are ordered by started
 * enrolments; the first `chartCourses` carry their points (`courses`), the
 * rest are listed without (`others`). Courses below the floor are listed in
 * `belowFloor` with counts only — no share, no drop.
 */
export function buildProgressCurve(
  items: readonly ProgressCurveItemRow[],
  enrollments: readonly ProgressCurveEnrollmentRow[],
  { floor, chartCourses }: ProgressCurveOptions,
): ProgressCurveBuild {
  const orderedByTrack = orderTrackItems(items);

  const byTrack = new Map<string, ProgressCurveEnrollmentRow[]>();
  for (const e of enrollments) {
    const list = byTrack.get(e.trackId);
    if (list) list.push(e);
    else byTrack.set(e.trackId, [e]);
  }

  const measurable: {
    summary: ProgressCurveCourseSummary;
    points: ProgressCurvePoint[];
  }[] = [];
  const belowFloor: ProgressCurveCourseSummary[] = [];
  for (const [trackId, rows] of byTrack) {
    const ordered = orderedByTrack.get(trackId) ?? [];
    const n = ordered.length;
    const started = rows.filter(isStartedEnrollment);
    const completed = started.filter((r) => r.completedAt !== null).length;
    const base = {
      trackId,
      title: rows[0].title,
      status: rows[0].status,
      items: n,
      enrolments: rows.length,
      startedEnrolments: started.length,
      completed,
      inChart: false,
    };
    if (started.length < floor || n === 0) {
      belowFloor.push({ ...base, completedPct: null, steepestDrop: null });
      continue;
    }

    const positionById = new Map(
      ordered.map((item, i) => [item.itemId, i + 1]),
    );
    const reachedCounts = new Array<number>(n).fill(0);
    const openedCounts = new Array<number>(n).fill(0);
    for (const row of started) {
      const furthest = furthestPosition(row, positionById, n);
      for (let k = 0; k < furthest; k += 1) reachedCounts[k] += 1;
      for (const id of new Set(row.openedItemIds)) {
        const p = positionById.get(id);
        if (p !== undefined) openedCounts[p - 1] += 1;
      }
    }

    measurable.push({
      summary: {
        ...base,
        completedPct: pct(completed, started.length),
        steepestDrop: steepestDrop(
          ordered,
          reachedCounts,
          completed,
          started.length,
        ),
      },
      points: ordered.map((item, k) => ({
        position: k + 1,
        positionPct: positionPct(k + 1, n),
        itemId: item.itemId,
        itemTitle: item.title,
        itemType: item.type,
        reached: reachedCounts[k],
        reachedPct: pct(reachedCounts[k], started.length),
        opened: openedCounts[k],
        openedPct: pct(openedCounts[k], started.length),
      })),
    });
  }

  const byStarted = (
    a: ProgressCurveCourseSummary,
    b: ProgressCurveCourseSummary,
  ) =>
    b.startedEnrolments - a.startedEnrolments ||
    b.enrolments - a.enrolments ||
    a.title.localeCompare(b.title) ||
    a.trackId.localeCompare(b.trackId);
  measurable.sort((a, b) => byStarted(a.summary, b.summary));
  belowFloor.sort(byStarted);

  const courses: ProgressCurveCourse[] = measurable
    .slice(0, chartCourses)
    .map(({ summary, points }) => ({ ...summary, inChart: true, points }));
  const others = measurable.slice(chartCourses).map((m) => m.summary);

  const all = [...measurable.map((m) => m.summary), ...belowFloor];
  return {
    courses,
    others,
    belowFloor,
    totals: {
      courses: all.length,
      measurable: measurable.length,
      enrolments: all.reduce((s, c) => s + c.enrolments, 0),
      startedEnrolments: all.reduce((s, c) => s + c.startedEnrolments, 0),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rank correlation
// ─────────────────────────────────────────────────────────────────────────────

/** r and its interval are withheld below this many points. */
export const MIN_POINTS_FOR_CORRELATION = 30;

/**
 * 1-based ranks of `values`, ties sharing the mean of the ranks they span
 * (so three values tied for 2nd–4th all rank 3).
 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].v === order[start].v) {
      end += 1;
    }
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) ranks[order[k].i] = rank;
    start = end + 1;
  }
  return ranks;
}

/** Pearson r; null below 3 pairs or when either side does not vary. */
export function pearson(
  xs: readonly number[],
  ys: readonly number[],
): number | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 1e-12 || syy <= 1e-12) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/**
 * Spearman's rank correlation: Pearson r on average ranks, which handles
 * ties correctly (the textbook 1 − 6Σd²/… shortcut does not). Null below 3
 * pairs or when either side is all one value.
 */
export function spearman(
  xs: readonly number[],
  ys: readonly number[],
): number | null {
  if (xs.length !== ys.length) return null;
  return pearson(averageRanks(xs), averageRanks(ys));
}

/**
 * mulberry32 — the same seedable PRNG as paired-stats.util (which keeps its
 * copy private), so this interval is deterministic too: the same data always
 * draws the same interval, and a chart that wobbled on refresh would read as
 * data moving.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Resamples for the correlation interval. Half the paired-change count:
 * every resample re-ranks the whole sample (n log n, not n), and 2,000 holds
 * a percentile interval steady to about ±0.01 in r.
 */
export const CORRELATION_BOOTSTRAP_RESAMPLES = 2000;
/** The same seed as every paired interval on the platform. */
export const CORRELATION_BOOTSTRAP_SEED = BOOTSTRAP_SEED;

/** One (x, y) observation and the person it belongs to. */
export interface ClusteredPoint {
  x: number;
  y: number;
  cluster: number;
}

/**
 * 95% percentile bootstrap interval of Spearman r, resampling PEOPLE, not
 * points: each resample draws learners with replacement and takes every
 * point of each drawn learner. A learner in three courses is three points
 * that are not independent of each other; resampling them one by one would
 * draw an interval too narrow. Resamples where r is undefined (one side all
 * ties) are skipped; null when fewer than half are usable, or below 2
 * learners.
 */
export function clusterBootstrapSpearmanCi(
  points: readonly ClusteredPoint[],
  resamples = CORRELATION_BOOTSTRAP_RESAMPLES,
  seed = CORRELATION_BOOTSTRAP_SEED,
): [number, number] | null {
  const groups = new Map<number, ClusteredPoint[]>();
  for (const p of points) {
    const list = groups.get(p.cluster);
    if (list) list.push(p);
    else groups.set(p.cluster, [p]);
  }
  const clusters = [...groups.keys()]
    .sort((a, b) => a - b)
    .map((k) => groups.get(k) as ClusteredPoint[]);
  const g = clusters.length;
  if (g < 2) return null;

  const rand = seededRandom(seed);
  const rs: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < g; i += 1) {
      for (const p of clusters[Math.floor(rand() * g)]) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
    const rho = spearman(xs, ys);
    if (rho !== null) rs.push(rho);
  }
  if (rs.length < resamples / 2) return null;
  rs.sort((a, b) => a - b);
  const m = rs.length;
  return [rs[Math.floor(0.025 * (m - 1))], rs[Math.ceil(0.975 * (m - 1))]];
}

/** A floored rank correlation, ready for a chart. */
export interface FlooredCorrelation {
  points: number;
  learners: number;
  r: number | null;
  rCi: [number, number] | null;
  /** True only when `rCi` excludes zero. Always false below the floor. */
  detectable: boolean;
}

/**
 * Spearman r with its learner-clustered interval, withheld (null, not
 * detectable) below `floor` points while the counts still travel. r and the
 * interval are rounded to 2 dp.
 */
export function flooredSpearman(
  points: readonly ClusteredPoint[],
  floor: number,
  resamples = CORRELATION_BOOTSTRAP_RESAMPLES,
): FlooredCorrelation {
  const learners = new Set(points.map((p) => p.cluster)).size;
  const base = { points: points.length, learners };
  if (points.length < floor) {
    return { ...base, r: null, rCi: null, detectable: false };
  }
  const rho = spearman(
    points.map((p) => p.x),
    points.map((p) => p.y),
  );
  if (rho === null) return { ...base, r: null, rCi: null, detectable: false };
  const ci = clusterBootstrapSpearmanCi(points, resamples);
  const rCi = ci ? ([round2(ci[0]), round2(ci[1])] as [number, number]) : null;
  return {
    ...base,
    r: round2(rho),
    rCi,
    detectable: !!ci && (ci[0] > 0 || ci[1] < 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Does knowing predict doing? (AAQ-226)
// ─────────────────────────────────────────────────────────────────────────────

/** One live enrolment in a live course that has at least one live quiz. */
export interface KnowledgeEnrollmentRow {
  trackId: string;
  title: string;
  status: string;
  quizItems: number;
  userId: number;
  /** Written at enrolment (TrackEnrollmentService.enroll). */
  startedAt: Date | null;
}

/**
 * A learner's FIRST attempt at one live quiz item — their earliest
 * `attemptNumber = 1` attempt (a re-enrolment restarts the count). `scorePct`
 * and `passed` are as stored; a still-pending or ungraded first attempt keeps
 * its row so a later attempt can never stand in as "first".
 */
export interface KnowledgeFirstAttemptRow {
  trackId: string;
  trackItemId: string;
  userId: number;
  scorePct: number | null;
  passed: boolean | null;
}

/** One scored helping-skills slice (R1, pinned rubric). */
export interface KnowledgeSkillCutRow {
  userId: number;
  /** When the session that closed the slice ended. Orders a learner's slices. */
  closedAt: Date;
  /**
   * When the slice's FIRST session ended — every session in the slice ended
   * on or after this. Null when that session can no longer be found.
   */
  firstEndedAt: Date | null;
  composite: number;
}

/**
 * The slices that count as "during and after" a course: the first `window`
 * whose FIRST session ended after the learner enrolled, so every session in
 * the slice postdates the enrolment (the same timing fields and the same
 * strictness course impact uses for its "after" side). A slice that straddles
 * the enrolment belongs to neither. Empty without an enrolment time.
 *
 * `cuts` must be one learner's, oldest first.
 */
export function duringAndAfterSlices(
  startedAt: Date | null,
  cuts: readonly KnowledgeSkillCutRow[],
  window: number,
): KnowledgeSkillCutRow[] {
  if (!startedAt) return [];
  const start = startedAt.getTime();
  return cuts
    .filter((c) => c.firstEndedAt !== null && c.firstEndedAt.getTime() > start)
    .slice(0, window);
}

/** A first attempt that produced a final score (not pending, not ungraded). */
const isScoredAttempt = (a: KnowledgeFirstAttemptRow): boolean =>
  a.scorePct !== null &&
  Number.isFinite(Number(a.scorePct)) &&
  a.passed !== null;

export interface KnowledgeSkillPoint {
  trackId: string;
  learnerId: number;
  quizScore: number;
  skillScore: number;
  quizzes: number;
  slices: number;
}

export interface KnowledgeSkillCourse {
  trackId: string;
  title: string;
  status: string;
  quizItems: number;
  enrolments: number;
  missingQuiz: number;
  missingSkill: number;
  correlation: FlooredCorrelation;
}

export interface KnowledgeSkillBuild {
  coverage: {
    courses: number;
    enrolments: number;
    points: number;
    learners: number;
    missingQuiz: number;
    missingSkill: number;
  };
  overall: FlooredCorrelation;
  courses: KnowledgeSkillCourse[];
  points: KnowledgeSkillPoint[];
}

export interface KnowledgeSkillOptions {
  /** Slices averaged for a learner's skill score. */
  window: number;
  /** Points needed before r is shown. */
  floor: number;
  resamples?: number;
}

/**
 * One point per learner × course (a learner has at most one live enrolment
 * per course): x = the mean of their first-attempt `scorePct` over the
 * course's quizzes they have a scored first attempt on; y = the mean
 * composite of {@link duringAndAfterSlices}. An enrolment with no scored first
 * attempt is `missingQuiz`; one with a quiz score but no such slice is
 * `missingSkill` — so `enrolments = points + missingQuiz + missingSkill`.
 *
 * `overall` correlates every point (a learner in two courses is two points,
 * and the interval resamples learners so that is not double-counted
 * certainty); each course's own correlation reads only its points.
 */
export function buildKnowledgeVsSkill(
  enrollments: readonly KnowledgeEnrollmentRow[],
  attempts: readonly KnowledgeFirstAttemptRow[],
  cuts: readonly KnowledgeSkillCutRow[],
  { window, floor, resamples }: KnowledgeSkillOptions,
): KnowledgeSkillBuild {
  const cutsByUser = new Map<number, KnowledgeSkillCutRow[]>();
  for (const c of cuts) {
    const list = cutsByUser.get(c.userId);
    if (list) list.push(c);
    else cutsByUser.set(c.userId, [c]);
  }
  for (const list of cutsByUser.values()) {
    list.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  }

  // One score per (course, learner, quiz) — the first attempt's, if scored.
  // The first row seen for a quiz decides it (the repository sends the
  // earliest first): an unscored first attempt leaves the quiz unscored
  // rather than letting a later row stand in.
  const quizScores = new Map<string, Map<string, number>>();
  const seen = new Set<string>();
  for (const a of attempts) {
    const pair = `${a.trackItemId}|${a.userId}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    if (!isScoredAttempt(a)) continue;
    const key = `${a.trackId}|${a.userId}`;
    const byItem = quizScores.get(key) ?? new Map<string, number>();
    byItem.set(a.trackItemId, Number(a.scorePct));
    quizScores.set(key, byItem);
  }

  // A learner has one live enrolment per course (unique index), but keep the
  // earliest-started one should two ever arrive.
  const byKey = new Map<string, KnowledgeEnrollmentRow>();
  for (const e of enrollments) {
    const key = `${e.trackId}|${e.userId}`;
    const prior = byKey.get(key);
    if (
      !prior ||
      (e.startedAt &&
        (!prior.startedAt || e.startedAt.getTime() < prior.startedAt.getTime()))
    ) {
      byKey.set(key, e);
    }
  }

  const points: KnowledgeSkillPoint[] = [];
  const perTrack = new Map<
    string,
    {
      row: KnowledgeEnrollmentRow;
      enrolments: number;
      missingQuiz: number;
      missingSkill: number;
      points: ClusteredPoint[];
    }
  >();
  for (const [key, e] of byKey) {
    const t = perTrack.get(e.trackId) ?? {
      row: e,
      enrolments: 0,
      missingQuiz: 0,
      missingSkill: 0,
      points: [],
    };
    perTrack.set(e.trackId, t);
    t.enrolments += 1;

    const scores = [...(quizScores.get(key)?.values() ?? [])];
    if (scores.length === 0) {
      t.missingQuiz += 1;
      continue;
    }
    const slices = duringAndAfterSlices(
      e.startedAt,
      cutsByUser.get(e.userId) ?? [],
      window,
    );
    if (slices.length === 0) {
      t.missingSkill += 1;
      continue;
    }
    const x = mean(scores);
    const y = mean(slices.map((c) => c.composite));
    t.points.push({ x, y, cluster: e.userId });
    points.push({
      trackId: e.trackId,
      learnerId: e.userId,
      quizScore: round1(x),
      skillScore: round2(y),
      quizzes: scores.length,
      slices: slices.length,
    });
  }

  points.sort(
    (a, b) => a.trackId.localeCompare(b.trackId) || a.learnerId - b.learnerId,
  );

  const courses: KnowledgeSkillCourse[] = [...perTrack.values()].map((t) => ({
    trackId: t.row.trackId,
    title: t.row.title,
    status: t.row.status,
    quizItems: t.row.quizItems,
    enrolments: t.enrolments,
    missingQuiz: t.missingQuiz,
    missingSkill: t.missingSkill,
    correlation: flooredSpearman(t.points, floor, resamples),
  }));
  courses.sort(
    (a, b) =>
      b.correlation.points - a.correlation.points ||
      b.enrolments - a.enrolments ||
      a.title.localeCompare(b.title) ||
      a.trackId.localeCompare(b.trackId),
  );

  const all = [...perTrack.values()].flatMap((t) => t.points);
  const overall = flooredSpearman(all, floor, resamples);
  return {
    coverage: {
      courses: courses.length,
      enrolments: courses.reduce((s, c) => s + c.enrolments, 0),
      points: points.length,
      learners: overall.learners,
      missingQuiz: courses.reduce((s, c) => s + c.missingQuiz, 0),
      missingSkill: courses.reduce((s, c) => s + c.missingSkill, 0),
    },
    overall,
    courses,
    points,
  };
}
