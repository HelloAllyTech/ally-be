import { Injectable } from '@nestjs/common';

import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  CourseFunnelQueryDto,
  CourseFunnelResponseDto,
  QuizFirstToBestDto,
  QuizOutcomeDto,
  QuizOutcomesQueryDto,
  QuizOutcomesResponseDto,
  RoleplayGateDto,
  RoleplayGatesQueryDto,
  RoleplayGatesResponseDto,
} from '../dto/curriculum-analytics.dto';
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import {
  CurriculumAnalyticsRepository,
  GatedRoleplayItemRow,
} from '../repository/curriculum-analytics.repository';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
// One floor for every judged score or rate on the platform.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  AnalyticsWindow,
  describeWindow,
  resolveAnalyticsWindow,
  WindowQuery,
} from '../util/analytics-window.util';
import {
  buildCourseFunnel,
  classifyGateProgress,
  collapseQuizAttempts,
  COURSE_FUNNEL_CHART_COURSES,
  COURSE_FUNNEL_STALLED_AFTER_DAYS,
  flooredPct,
  GateOutcome,
  GateProgressRow,
  gateCalibration,
  isScoreGate,
  median,
  missedQuestions,
  QuizAttemptRow,
  QuizItemRow,
  ROLEPLAY_GATE_STUCK_AFTER_DAYS,
  ROLEPLAY_GATE_TOO_EASY_ABOVE_PCT,
  ROLEPLAY_GATE_TOO_HARD_BELOW_PCT,
} from '../util/curriculum.util';
import { flooredPairedComparison } from '../util/paired-stats.util';

/** Courses take weeks: a 12-month cohort is the default read. */
const CURRICULUM_DEFAULT_RANGE: AnalyticsRange = '12m';

const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '30d' ? 'day' : range === '90d' ? 'week' : 'month';

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Quiz outcomes from the reads, pure so the pairing, collapse and floors are
 * tested without a database. Rows are sorted hardest first (lowest first-time
 * pass), withheld rows last.
 */
export function buildQuizOutcomes(
  items: readonly QuizItemRow[],
  attempts: readonly QuizAttemptRow[],
  start: Date,
  end: Date,
  floor: number,
): Pick<QuizOutcomesResponseDto, 'summary' | 'quizzes'> {
  const itemById = new Map(items.map((i) => [i.trackItemId, i]));
  const outcomes = collapseQuizAttempts(attempts, start, end);
  const byItem = new Map<string, typeof outcomes>();
  for (const o of outcomes) {
    const list = byItem.get(o.trackItemId);
    if (list) list.push(o);
    else byItem.set(o.trackItemId, [o]);
  }

  const quizzes: QuizOutcomeDto[] = [];
  for (const [trackItemId, list] of byItem) {
    const item = itemById.get(trackItemId);
    // An item missing from the live catalogue was deleted mid-read; skip it.
    if (!item) continue;
    const scored = list.filter((o) => o.firstScore !== null);
    const n = scored.length;
    const withheld = n < floor;
    const passedFirst = scored.filter((o) => o.firstPassed).length;
    const retried = scored.filter((o) => o.retried).length;
    const paired = scored.filter((o) => o.scoredAttempts >= 2);
    const comparison = flooredPairedComparison(
      paired.map((o) => o.firstScore as number),
      paired.map((o) => o.bestScore as number),
      floor,
    );
    const firstToBest: QuizFirstToBestDto = {
      learners: comparison.n,
      firstAvg: comparison.beforeAvg,
      bestAvg: comparison.afterAvg,
      change: comparison.change,
      changeCi: comparison.changeCi,
      up: comparison.up,
      down: comparison.down,
      tied: comparison.tied,
      signP: comparison.signP,
      detectable: comparison.detectable,
    };
    quizzes.push({
      trackItemId,
      title: item.title,
      trackId: item.trackId,
      trackTitle: item.trackTitle,
      firstAttempts: n,
      unscoredFirstAttempts: list.length - n,
      passedFirst,
      passedFirstPct: flooredPct(passedFirst, n, n, floor),
      retried,
      retriedPct: flooredPct(retried, n, n, floor),
      passedLater: scored.filter((o) => o.passedLater).length,
      withheld,
      firstToBest,
      missedQuestions: missedQuestions(scored, item.questions, floor),
    });
  }

  quizzes.sort((a, b) => {
    if (a.withheld !== b.withheld) return a.withheld ? 1 : -1;
    if (!a.withheld && a.passedFirstPct !== b.passedFirstPct) {
      return (a.passedFirstPct ?? 0) - (b.passedFirstPct ?? 0);
    }
    return (
      b.firstAttempts - a.firstAttempts ||
      a.title.localeCompare(b.title) ||
      a.trackItemId.localeCompare(b.trackItemId)
    );
  });

  return {
    summary: {
      quizzes: quizzes.length,
      measurable: quizzes.filter((q) => !q.withheld).length,
      firstAttempts: quizzes.reduce((s, q) => s + q.firstAttempts, 0),
    },
    quizzes,
  };
}

/**
 * Roleplay gates from the reads, pure. Items whose minScore is 0 or below are
 * ungated (`isScoreGate`, which defers to `meetsMinimumScore`) and only
 * counted. Sorted lowest first-time pass first, withheld rows last.
 */
export function buildRoleplayGates(
  items: readonly GatedRoleplayItemRow[],
  progress: readonly GateProgressRow[],
  now: Date,
  floor: number,
  cohortFloor: number,
): Pick<RoleplayGatesResponseDto, 'summary' | 'items'> {
  const byItem = new Map<string, GateProgressRow[]>();
  for (const row of progress) {
    if (row.sessions < 1) continue;
    const list = byItem.get(row.trackItemId);
    if (list) list.push(row);
    else byItem.set(row.trackItemId, [row]);
  }

  let ungatedItems = 0;
  const gates: RoleplayGateDto[] = [];
  for (const item of items) {
    const rows = byItem.get(item.trackItemId);
    if (!rows?.length) continue;
    if (!isScoreGate(item.minScore)) {
      ungatedItems += 1;
      continue;
    }
    const counts: Record<GateOutcome, number> = {
      passedFirst: 0,
      passedLater: 0,
      stuck: 0,
      inProgress: 0,
    };
    for (const row of rows) {
      counts[classifyGateProgress(row, item.minScore, now)] += 1;
    }
    const n = rows.length;
    const withheld = n < floor;
    const share = (k: number) => flooredPct(k, n, n, floor);
    const attempts = rows
      .filter((r) => r.status === 'COMPLETED' && r.attemptCount >= 1)
      .map((r) => r.attemptCount);
    const midAttempts =
      !withheld && attempts.length >= cohortFloor ? median(attempts) : null;
    const passedFirstPct = share(counts.passedFirst);
    gates.push({
      trackItemId: item.trackItemId,
      title: item.title,
      trackId: item.trackId,
      trackTitle: item.trackTitle,
      scenarioId: item.scenarioId,
      minScore: item.minScore,
      progressRows: n,
      ...counts,
      passedFirstPct,
      passedLaterPct: share(counts.passedLater),
      stuckPct: share(counts.stuck),
      inProgressPct: share(counts.inProgress),
      medianAttemptsToPass: midAttempts === null ? null : round1(midAttempts),
      calibration: gateCalibration(passedFirstPct),
      withheld,
    });
  }

  gates.sort((a, b) => {
    if (a.withheld !== b.withheld) return a.withheld ? 1 : -1;
    if (!a.withheld && a.passedFirstPct !== b.passedFirstPct) {
      return (a.passedFirstPct ?? 0) - (b.passedFirstPct ?? 0);
    }
    return (
      b.progressRows - a.progressRows ||
      a.title.localeCompare(b.title) ||
      a.trackItemId.localeCompare(b.trackItemId)
    );
  });

  return {
    summary: {
      items: gates.length,
      measurable: gates.filter((g) => !g.withheld).length,
      tooHard: gates.filter((g) => g.calibration === 'tooHard').length,
      tooEasy: gates.filter((g) => g.calibration === 'tooEasy').length,
      progressRows: gates.reduce((s, g) => s + g.progressRows, 0),
      ungatedItems,
    },
    items: gates,
  };
}

/**
 * Highlights → Curriculum: course funnel (AAQ-210), quiz outcomes
 * (AAQ-211/212) and roleplay gates (AAQ-213). Thin — the repository reads,
 * `util/curriculum.util.ts` and the `build*` functions above hold every rule.
 * With no data each returns empty lists and zero counts, never a 404.
 */
@Injectable()
export class CurriculumAnalyticsService {
  constructor(private readonly repository: CurriculumAnalyticsRepository) {}

  private async window(query: WindowQuery): Promise<AnalyticsWindow> {
    const needsFloor =
      (query.range ?? CURRICULUM_DEFAULT_RANGE) === 'all' &&
      !query.from &&
      !query.to;
    return resolveAnalyticsWindow(query, {
      defaultRange: CURRICULUM_DEFAULT_RANGE,
      defaultBucketFor,
      allTimeStart: needsFloor
        ? await this.repository.getDataFloor()
        : undefined,
    });
  }

  async getCourseFunnel(
    query: CourseFunnelQueryDto = {},
  ): Promise<CourseFunnelResponseDto> {
    const window = await this.window(query);
    const tenantId = query.tenantId?.trim() || undefined;
    const rows = await this.repository.getFunnelEnrollments(
      window.start,
      window.endExclusive,
      tenantId,
    );
    const now = new Date();
    const built = buildCourseFunnel(rows, now, MIN_COHORT_SIZE);
    const t = built.totals;
    return {
      window: describeWindow(window, now),
      minCohortSize: MIN_COHORT_SIZE,
      stalledAfterDays: COURSE_FUNNEL_STALLED_AFTER_DAYS,
      chartCourses: COURSE_FUNNEL_CHART_COURSES,
      totals: {
        ...t,
        completedPct: flooredPct(
          t.completed,
          t.enrolled,
          t.enrolled,
          MIN_COHORT_SIZE,
        ),
        stalledPct: flooredPct(
          t.stalled,
          t.started,
          t.enrolled,
          MIN_COHORT_SIZE,
        ),
      },
      courses: built.courses,
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      provenance: {
        derivation:
          'R10 course progress (track_enrollments, track_item_progress, tracks). Cohort = enrolments created in ' +
          'the window, in live or archived courses. Started = opened or completed at least one item; halfway = ' +
          'completed at least half the course’s items (completedItems ÷ totalItems, the tenant course-usage ' +
          `definition) or finished; finished = completedAt set; stalled = started, unfinished, no course activity ` +
          `in the last ${COURSE_FUNNEL_STALLED_AFTER_DAYS} days as of today. Days to finish = enrol → completedAt, ` +
          `median and interquartile range over finishers. Rates and medians over fewer than ${MIN_COHORT_SIZE} ` +
          'learners are withheld.',
        note:
          'A recent cohort has had less time to finish, so a short window reads lower than a long one. Halfway is ' +
          'measured against the course as it stands today: items added after a learner enrolled lower their share. ' +
          'Test organisations excluded.',
      },
      computedAt: now.toISOString(),
    };
  }

  async getQuizOutcomes(
    query: QuizOutcomesQueryDto = {},
  ): Promise<QuizOutcomesResponseDto> {
    const window = await this.window(query);
    const tenantId = query.tenantId?.trim() || undefined;
    const [items, attempts] = await Promise.all([
      this.repository.getQuizItems(),
      this.repository.getQuizAttempts(
        window.start,
        window.endExclusive,
        tenantId,
      ),
    ]);
    const now = new Date();
    const built = buildQuizOutcomes(
      items,
      attempts,
      window.start,
      window.endExclusive,
      MIN_SCORE_SAMPLE_SIZE,
    );
    return {
      window: describeWindow(window, now),
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: [0, 100],
      ...built,
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      provenance: {
        derivation:
          'R5 quiz attempts (track_quiz_attempts). One row per learner per quiz: their first attempt is their ' +
          'earliest attemptNumber 1, and they count when it was submitted in the window. Pass on first attempt = ' +
          'that attempt passed, over learners whose first attempt is scored. First → best = each learner’s best ' +
          'scored attempt (to the window’s end) against their first, over learners with two or more scored ' +
          'attempts, with a 95% paired bootstrap interval. Most-missed questions are counted from the first ' +
          `attempt’s per-question grading, by question id and type only. Rates and changes over fewer than ` +
          `${MIN_SCORE_SAMPLE_SIZE} learners are withheld.`,
        note:
          'Open-ended answers are graded by an LLM (AI task track-quiz-grading), so a step in a quiz’s pass rate may ' +
          'be a grader change rather than a learner one. Best is never below first by construction: the gain says ' +
          'how much a retry recovers, not how much was learned. Attempts still awaiting grading are counted apart. ' +
          'Test organisations excluded.',
      },
      computedAt: now.toISOString(),
    };
  }

  async getRoleplayGates(
    query: RoleplayGatesQueryDto = {},
  ): Promise<RoleplayGatesResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const [items, progress] = await Promise.all([
      this.repository.getGatedRoleplayItems(),
      this.repository.getGateProgress(tenantId),
    ]);
    const now = new Date();
    const built = buildRoleplayGates(
      items,
      progress,
      now,
      MIN_SCORE_SAMPLE_SIZE,
      MIN_COHORT_SIZE,
    );
    return {
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minCohortSize: MIN_COHORT_SIZE,
      stuckAfterDays: ROLEPLAY_GATE_STUCK_AFTER_DAYS,
      calibrationBand: {
        tooHardBelowPct: ROLEPLAY_GATE_TOO_HARD_BELOW_PCT,
        tooEasyAbovePct: ROLEPLAY_GATE_TOO_EASY_ABOVE_PCT,
      },
      ...built,
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      provenance: {
        derivation:
          'R2 session score against R10 course progress, all time. Per course roleplay whose completionCriteria ' +
          'carries a minScore above 0 (0 means no gate): every learner progress row with at least one linked ' +
          'countable session (scenario_sessions.trackItemProgressId; ended, completed, not a preview room). ' +
          'Passed first time = completed and the first session’s score cleared the gate (the same ' +
          'meetsMinimumScore rule the course uses; a missing score reads as 0); passed later = completed ' +
          `otherwise; stuck = unfinished, still unlocked, last session over ${ROLEPLAY_GATE_STUCK_AFTER_DAYS} days ` +
          'ago. Attempts to pass = the progression engine’s attemptCount at completion. Shares over fewer than ' +
          `${MIN_SCORE_SAMPLE_SIZE} progress rows are withheld; a gate under ${ROLEPLAY_GATE_TOO_HARD_BELOW_PCT}% ` +
          `or over ${ROLEPLAY_GATE_TOO_EASY_ABOVE_PCT}% first-time pass is flagged for a calibration check.`,
        note:
          'A session score is scenario-scaled, so a gate’s pass rate says whether the gate fits its scenario, not ' +
          'whether learners are skilled. The gate is read at its current value: one edited since is applied to ' +
          'past attempts too. Test organisations excluded.',
      },
      computedAt: now.toISOString(),
    };
  }
}
