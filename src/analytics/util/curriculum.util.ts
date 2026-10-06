/**
 * Pure logic behind Highlights → Curriculum (course funnel, quiz outcomes,
 * roleplay gates) and the course-impact medians: the stage rules, the
 * per-learner collapses, the floors and the classifications, kept free of the
 * database so every rule is tested over fixtures.
 *
 * Floors follow the analytics house rule: below a floor the number is null
 * and the count still travels, and a zero denominator is "no data", never 0.
 */
import { meetsMinimumScore } from 'src/common/util/progression.util';

// ─────────────────────────────────────────────────────────────────────────────
// Shared arithmetic
// ─────────────────────────────────────────────────────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The `q` quantile (0–1) of `values` by linear interpolation between closest
 * ranks — the same definition as Postgres `percentile_cont`, so a median
 * computed here and one computed in SQL agree. Null for no values.
 */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const median = (values: readonly number[]): number | null =>
  quantile(values, 0.5);

/** `num / den` as a percentage to one decimal; null on a zero denominator. */
export function pct(num: number, den: number): number | null {
  return den > 0 ? round1((num / den) * 100) : null;
}

/** A percentage withheld (null) when its population is below `floor`. */
export function flooredPct(
  num: number,
  den: number,
  population: number,
  floor: number,
): number | null {
  return population >= floor ? pct(num, den) : null;
}

const MS_PER_DAY = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Course funnel (EFF-21)
// ─────────────────────────────────────────────────────────────────────────────

/** No activity on an unfinished, started enrolment for this many days = stalled. */
export const COURSE_FUNNEL_STALLED_AFTER_DAYS = 30;

/** Courses drawn in the funnel chart (by enrolments); the rest stay in the table. */
export const COURSE_FUNNEL_CHART_COURSES = 15;

/** One enrolment, as the funnel repository reads it. */
export interface FunnelEnrollmentRow {
  trackId: string;
  title: string;
  status: string;
  totalItems: number;
  /** At least one item opened (`track_item_progress.startedAt`) or completed. */
  openedAnyItem: boolean;
  completedItems: number;
  /** The shared "reached half" SQL definition (course-progress-sql.util). */
  reachedHalf: boolean;
  completedAt: Date | null;
  /** Enrol → complete in days (shared SQL definition); null until completed. */
  daysToComplete: number | null;
  lastActivityAt: Date | null;
}

/** Which funnel stages one enrolment has reached. Each stage implies the one before. */
export interface FunnelStages {
  started: boolean;
  halfway: boolean;
  completed: boolean;
  stalled: boolean;
}

/**
 * The stage rules, in one place.
 *
 * - **started**: opened or completed at least one item. NOT
 *   `track_enrollments.startedAt` — enrolling writes that immediately, so it
 *   cannot separate "enrolled" from "started".
 * - **halfway**: reached half the course's items, or finished it.
 * - **completed**: `completedAt` is set.
 * - **stalled**: started, not completed, and no activity in the last
 *   {@link COURSE_FUNNEL_STALLED_AFTER_DAYS} days as of `now` (never-active
 *   counts as stalled).
 *
 * Stages are forced monotone (completed ⊂ halfway ⊂ started) so a counter
 * that drifted (a course edited after enrolment) cannot make the funnel widen.
 */
export function funnelStages(
  row: FunnelEnrollmentRow,
  now: Date,
): FunnelStages {
  const completed = row.completedAt !== null;
  const halfway = completed || row.reachedHalf;
  const started = halfway || row.openedAnyItem || row.completedItems > 0;
  const cutoff = now.getTime() - COURSE_FUNNEL_STALLED_AFTER_DAYS * MS_PER_DAY;
  const stalled =
    started &&
    !completed &&
    (row.lastActivityAt === null || row.lastActivityAt.getTime() < cutoff);
  return { started, halfway, completed, stalled };
}

export interface CourseFunnelRowResult {
  trackId: string;
  title: string;
  status: string;
  totalItems: number;
  enrolled: number;
  started: number;
  halfway: number;
  completed: number;
  stalled: number;
  startedPct: number | null;
  halfwayPct: number | null;
  completedPct: number | null;
  stalledPct: number | null;
  medianDaysToComplete: number | null;
  daysToCompleteIqr: [number, number] | null;
  inChart: boolean;
}

export interface CourseFunnelBuild {
  courses: CourseFunnelRowResult[];
  totals: {
    courses: number;
    enrolled: number;
    started: number;
    halfway: number;
    completed: number;
    stalled: number;
  };
}

/**
 * Per-course funnel from enrolment rows. Rates are over enrolled and withheld
 * below `floor` enrolled; the days-to-complete median and IQR are over
 * finishers and withheld below `floor` finishers (a median of two people's
 * durations is a statement about those two). Courses are ordered by
 * enrolments, and the first {@link COURSE_FUNNEL_CHART_COURSES} are flagged
 * `inChart`.
 */
export function buildCourseFunnel(
  rows: readonly FunnelEnrollmentRow[],
  now: Date,
  floor: number,
): CourseFunnelBuild {
  const byTrack = new Map<string, FunnelEnrollmentRow[]>();
  for (const row of rows) {
    const list = byTrack.get(row.trackId);
    if (list) list.push(row);
    else byTrack.set(row.trackId, [row]);
  }

  const courses: CourseFunnelRowResult[] = [];
  for (const [trackId, list] of byTrack) {
    const stages = list.map((r) => funnelStages(r, now));
    const enrolled = list.length;
    const started = stages.filter((s) => s.started).length;
    const halfway = stages.filter((s) => s.halfway).length;
    const completed = stages.filter((s) => s.completed).length;
    const stalled = stages.filter((s) => s.stalled).length;
    const days = list
      .filter((r) => r.completedAt !== null && r.daysToComplete !== null)
      .map((r) => Math.max(0, Number(r.daysToComplete)));
    const enoughFinishers = days.length >= floor;
    const p25 = quantile(days, 0.25);
    const p75 = quantile(days, 0.75);
    const mid = median(days);
    courses.push({
      trackId,
      title: list[0].title,
      status: list[0].status,
      totalItems: list[0].totalItems,
      enrolled,
      started,
      halfway,
      completed,
      stalled,
      startedPct: flooredPct(started, enrolled, enrolled, floor),
      halfwayPct: flooredPct(halfway, enrolled, enrolled, floor),
      completedPct: flooredPct(completed, enrolled, enrolled, floor),
      stalledPct: flooredPct(stalled, started, enrolled, floor),
      medianDaysToComplete:
        enoughFinishers && mid !== null ? round1(mid) : null,
      daysToCompleteIqr:
        enoughFinishers && p25 !== null && p75 !== null
          ? [round1(p25), round1(p75)]
          : null,
      inChart: false,
    });
  }

  courses.sort(
    (a, b) =>
      b.enrolled - a.enrolled ||
      a.title.localeCompare(b.title) ||
      a.trackId.localeCompare(b.trackId),
  );
  courses.forEach((c, i) => {
    c.inChart = i < COURSE_FUNNEL_CHART_COURSES;
  });

  const sum = (
    key: 'enrolled' | 'started' | 'halfway' | 'completed' | 'stalled',
  ) => courses.reduce((n, c) => n + c[key], 0);
  return {
    courses,
    totals: {
      courses: courses.length,
      enrolled: sum('enrolled'),
      started: sum('started'),
      halfway: sum('halfway'),
      completed: sum('completed'),
      stalled: sum('stalled'),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quiz outcomes (EFF-23a/b)
// ─────────────────────────────────────────────────────────────────────────────

/** Questions listed per quiz in the expanded view. */
export const QUIZ_MISSED_QUESTIONS_PER_QUIZ = 5;

/** One question's grading on a first attempt — ids and flags only, never text. */
export interface QuizGradingFlag {
  questionId: string;
  correct: boolean | null;
  graded: boolean | null;
}

/** One quiz attempt, as the repository reads it. */
export interface QuizAttemptRow {
  attemptId: string;
  trackItemId: string;
  userId: number;
  attemptNumber: number;
  submittedAt: Date;
  /** Null for an attempt with nothing graded (a survey) or still pending. */
  scorePct: number | null;
  /** Null while LLM grading is pending. */
  passed: boolean | null;
  /** Only on `attemptNumber = 1` attempts; null otherwise. */
  grading: QuizGradingFlag[] | null;
}

/** A question as the quiz defines it today — id, type and position, no prompt text. */
export interface QuizQuestionMeta {
  id: string;
  type: string | null;
  position: number;
}

export interface QuizItemRow {
  trackItemId: string;
  title: string;
  trackId: string;
  trackTitle: string;
  questions: QuizQuestionMeta[];
}

/** An attempt that produced a pass/fail on a scored quiz. */
const isScored = (a: QuizAttemptRow): boolean =>
  a.scorePct !== null && a.passed !== null;

const byTime = (a: QuizAttemptRow, b: QuizAttemptRow): number =>
  a.submittedAt.getTime() - b.submittedAt.getTime() ||
  a.attemptNumber - b.attemptNumber ||
  a.attemptId.localeCompare(b.attemptId);

/** One learner on one quiz, collapsed from their attempts. */
export interface QuizLearnerOutcome {
  trackItemId: string;
  userId: number;
  /** Their first attempt, scored; null when it is still pending or unscored. */
  firstScore: number | null;
  firstPassed: boolean | null;
  /** Best score over their scored attempts in the window; null without one. */
  bestScore: number | null;
  scoredAttempts: number;
  /** Any attempt (scored or not) after their first. */
  retried: boolean;
  /** Failed first, passed on a later scored attempt. */
  passedLater: boolean;
  firstGrading: QuizGradingFlag[] | null;
}

/**
 * Collapse attempts to ONE outcome per learner per quiz.
 *
 * A learner's first attempt is their EARLIEST `attemptNumber = 1` attempt (a
 * re-enrolment restarts the count, so a learner can have two), and the
 * learner belongs to the window only when that attempt was submitted inside
 * it — a learner who first sat the quiz before the window is not a first
 * attempt now. When the first attempt is pending or unscored the learner is
 * still counted (as pending) but contributes no score; their second attempt
 * never stands in as "first". Attempts submitted at or after `end` are
 * ignored.
 */
export function collapseQuizAttempts(
  attempts: readonly QuizAttemptRow[],
  start: Date,
  end: Date,
): QuizLearnerOutcome[] {
  const groups = new Map<string, QuizAttemptRow[]>();
  for (const a of attempts) {
    if (a.submittedAt.getTime() >= end.getTime()) continue;
    const key = `${a.trackItemId}|${a.userId}`;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }

  const out: QuizLearnerOutcome[] = [];
  for (const list of groups.values()) {
    list.sort(byTime);
    const first = list.find((a) => a.attemptNumber === 1);
    if (!first) continue;
    const t = first.submittedAt.getTime();
    if (t < start.getTime() || t >= end.getTime()) continue;
    const fromFirst = list.slice(list.indexOf(first));
    const scored = fromFirst.filter(isScored);
    const firstScored = isScored(first);
    const later = fromFirst.slice(1);
    out.push({
      trackItemId: first.trackItemId,
      userId: first.userId,
      firstScore: firstScored ? Number(first.scorePct) : null,
      firstPassed: firstScored ? !!first.passed : null,
      bestScore: scored.length
        ? Math.max(...scored.map((a) => Number(a.scorePct)))
        : null,
      scoredAttempts: scored.length,
      retried: later.length > 0,
      passedLater:
        firstScored &&
        !first.passed &&
        later.some((a) => isScored(a) && !!a.passed),
      firstGrading: first.grading,
    });
  }
  return out;
}

export interface QuizMissedQuestion {
  questionId: string;
  type: string | null;
  position: number | null;
  wrong: number;
  graded: number;
  wrongPct: number | null;
}

/**
 * The questions most often wrong on a first attempt, from the per-question
 * grading — by id, type and position only. A question counts for a learner
 * only when it was graded on their first attempt (`graded` not false and
 * `correct` not null: a pending open-ended answer is neither right nor wrong).
 * The share is withheld below `floor` graded first attempts. Top `limit` by
 * wrong count; questions nobody got wrong are not listed.
 */
export function missedQuestions(
  outcomes: readonly QuizLearnerOutcome[],
  questions: readonly QuizQuestionMeta[],
  floor: number,
  limit = QUIZ_MISSED_QUESTIONS_PER_QUIZ,
): QuizMissedQuestion[] {
  const meta = new Map(questions.map((q) => [q.id, q]));
  const tally = new Map<string, { wrong: number; graded: number }>();
  for (const o of outcomes) {
    if (o.firstScore === null) continue;
    for (const g of o.firstGrading ?? []) {
      if (!g.questionId || g.graded === false || g.correct === null) continue;
      const t = tally.get(g.questionId) ?? { wrong: 0, graded: 0 };
      t.graded += 1;
      if (g.correct === false) t.wrong += 1;
      tally.set(g.questionId, t);
    }
  }
  return [...tally.entries()]
    .filter(([, t]) => t.wrong > 0)
    .map(([questionId, t]) => ({
      questionId,
      type: meta.get(questionId)?.type ?? null,
      position: meta.get(questionId)?.position ?? null,
      wrong: t.wrong,
      graded: t.graded,
      wrongPct: t.graded >= floor ? pct(t.wrong, t.graded) : null,
    }))
    .sort(
      (a, b) =>
        b.wrong - a.wrong ||
        b.graded - a.graded ||
        (a.position ?? Infinity) - (b.position ?? Infinity) ||
        a.questionId.localeCompare(b.questionId),
    )
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Roleplay gates (EFF-24)
// ─────────────────────────────────────────────────────────────────────────────

/** An unfinished gate with no session for this many days = stuck. */
export const ROLEPLAY_GATE_STUCK_AFTER_DAYS = 14;

/** First-time pass shares outside this band flag the gate for a calibration check. */
export const ROLEPLAY_GATE_TOO_HARD_BELOW_PCT = 40;
export const ROLEPLAY_GATE_TOO_EASY_ABOVE_PCT = 95;

export type GateCalibration = 'tooHard' | 'tooEasy';

/**
 * Whether a `minScore` is a real score gate, decided by the progression
 * helper itself rather than restated: a gate exists exactly when some score
 * can fail it. `meetsMinimumScore` passes everything for a missing minimum
 * and for a minimum of 0 or below ("0 means no gate"), so those items are
 * ungated here too.
 */
export function isScoreGate(minScore: number | null | undefined): boolean {
  return !meetsMinimumScore(Number.NEGATIVE_INFINITY, minScore);
}

/** One progress row on a gated roleplay item, with its linked sessions summarised. */
export interface GateProgressRow {
  trackItemId: string;
  status: string;
  completedAt: Date | null;
  /** The engine's counter: roleplay ends recorded while the item was not yet complete. */
  attemptCount: number;
  /** Countable linked sessions. */
  sessions: number;
  /** `scenario_sessions.score` of the first linked session (null = no score). */
  firstScore: number | null;
  lastSessionAt: Date | null;
}

export type GateOutcome =
  | 'passedFirst'
  | 'passedLater'
  | 'stuck'
  | 'inProgress';

/**
 * Classify one progress row (that has at least one linked session):
 *
 * - **passedFirst**: the item is COMPLETED and its FIRST linked session
 *   cleared the score gate (`meetsMinimumScore`, so a missing score reads as
 *   0, exactly as the gate read it).
 * - **passedLater**: COMPLETED, but the first session did not clear it.
 * - **stuck**: not completed, still UNLOCKED, and the last session was more
 *   than {@link ROLEPLAY_GATE_STUCK_AFTER_DAYS} days before `now`.
 * - **inProgress**: everything else not completed.
 */
export function classifyGateProgress(
  row: GateProgressRow,
  minScore: number,
  now: Date,
): GateOutcome {
  if (row.status === 'COMPLETED') {
    return meetsMinimumScore(row.firstScore, minScore)
      ? 'passedFirst'
      : 'passedLater';
  }
  const cutoff = now.getTime() - ROLEPLAY_GATE_STUCK_AFTER_DAYS * MS_PER_DAY;
  if (
    row.status === 'UNLOCKED' &&
    row.lastSessionAt !== null &&
    row.lastSessionAt.getTime() < cutoff
  ) {
    return 'stuck';
  }
  return 'inProgress';
}

/** The calibration flag for a first-time pass share; null when withheld or within the band. */
export function gateCalibration(
  passedFirstPct: number | null,
): GateCalibration | null {
  if (passedFirstPct === null) return null;
  if (passedFirstPct < ROLEPLAY_GATE_TOO_HARD_BELOW_PCT) return 'tooHard';
  if (passedFirstPct > ROLEPLAY_GATE_TOO_EASY_ABOVE_PCT) return 'tooEasy';
  return null;
}
