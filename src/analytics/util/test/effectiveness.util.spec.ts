import type { FoundationalSkillsLearnerCutRow } from '../../repository/foundational-skills-analytics.repository';
import {
  EFFECTIVENESS_FUNNEL_STAGES,
  EffectivenessLearner,
  FunnelPopulationRow,
  SegmentContext,
  SegmentDimension,
  SessionSegmentAttributes,
  buildEffectivenessFunnel,
  buildSegments,
  groupCutRows,
  resolveSegmentPanel,
  segmentChange,
} from '../effectiveness.util';
import {
  FHS_PROGRESS_THRESHOLDS,
  computeProgress,
} from '../foundational-skills-progress.util';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

/** Deterministic noise in [-0.5, 0.5). */
const wobble = (u: number, k: number): number => {
  const x = Math.sin(u * 97.13 + k * 13.7) * 10000;
  return x - Math.floor(x) - 0.5;
};

const row = (
  userId: number,
  cut: number,
  score: number,
  extra: Partial<FoundationalSkillsLearnerCutRow> = {},
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: `Learner ${userId}`,
  tenantId: 't-1',
  cut,
  closedAt: new Date(T0 + (userId * 100 + cut) * DAY),
  score,
  unhelpful: score < 2,
  levels: { verbal: Math.round(score) },
  verdicts: [],
  sessionIds: [`s-${userId}-${cut}`],
  ...extra,
});

/** `count` learners, learner u has `cutsFor(u)` cuts trending by `slope(u)`. */
const cohort = (
  count: number,
  cutsFor: (u: number) => number,
  slope: (u: number) => number = () => 0.05,
  extra: (
    u: number,
    k: number,
  ) => Partial<FoundationalSkillsLearnerCutRow> = () => ({}),
): FoundationalSkillsLearnerCutRow[] =>
  Array.from({ length: count }, (_, i) => i + 1).flatMap((u) =>
    Array.from({ length: cutsFor(u) }, (_, j) => j + 1).map((k) =>
      row(
        u,
        k,
        Math.min(4, Math.max(1, 2.5 + slope(u) * k + 0.6 * wobble(u, k))),
        extra(u, k),
      ),
    ),
  );

const population = (
  entries: [userId: number, sessions: number][],
): FunnelPopulationRow[] =>
  entries.map(([userId, countableSessions]) => ({ userId, countableSessions }));

const FLOORS = { minCohort: 5, sampleFloor: 20 };

/* -------------------------------------------------------------------------- */
/* groupCutRows                                                               */
/* -------------------------------------------------------------------------- */

describe('groupCutRows', () => {
  it('folds rows like the Helping skills service: row order, cuts ascending, latest tenant', () => {
    const learners = groupCutRows([
      row(2, 2, 3, { tenantId: 't-a' }),
      row(2, 1, 2, { tenantId: 't-b' }),
      row(1, 1, 2.5),
    ]);
    expect(learners.map((l) => l.userId)).toEqual([2, 1]);
    expect(learners[0].cuts.map((c) => c.cut)).toEqual([1, 2]);
    // The service keeps the LAST non-null tenant in row order.
    expect(learners[0].tenantId).toBe('t-b');
    expect(learners[0].facts.get(2)?.tenantId).toBe('t-a');
    expect(learners[0].facts.get(1)?.sessionIds).toEqual(['s-2-1']);
  });
});

/* -------------------------------------------------------------------------- */
/* EFF-02 · funnel                                                            */
/* -------------------------------------------------------------------------- */

describe('buildEffectivenessFunnel', () => {
  const stageCounts = (r: ReturnType<typeof buildEffectivenessFunnel>) =>
    Object.fromEntries(r.stages.map((s) => [s.key, s.reached]));

  it('serves the seven stages in order, the last one terminal', () => {
    const r = buildEffectivenessFunnel({
      population: [],
      cutLearners: [],
      ...FLOORS,
    });
    expect(r.stages.map((s) => s.key)).toEqual(
      EFFECTIVENESS_FUNNEL_STAGES.map((s) => s.key),
    );
    expect(r.stages.map((s) => s.terminal)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    // Nobody: counts are zero, every share is withheld — never a 0%.
    for (const s of r.stages) {
      expect(s.reached).toBe(0);
      expect(s.ofEnteredPct).toBeNull();
      expect(s.ofPreviousPct).toBeNull();
    }
  });

  it('never widens: a scored cut without two countable sessions, or outside the population, is clamped out', () => {
    // Learners 1–8 measured. 7 played one long session; 8 is a trainer
    // (not a learner-role account). 9–12 never got a cut.
    const cutLearners = groupCutRows([
      ...cohort(6, () => 4),
      ...cohort(1, () => 5).map((r) => ({ ...r, userId: 7 })),
      ...cohort(1, () => 6).map((r) => ({ ...r, userId: 8 })),
    ]);
    const r = buildEffectivenessFunnel({
      population: population([
        [1, 3],
        [2, 2],
        [3, 2],
        [4, 9],
        [5, 2],
        [6, 2],
        [7, 1],
        [9, 0],
        [10, 1],
        [11, 2],
        [12, 0],
      ]),
      cutLearners,
      ...FLOORS,
    });
    const c = stageCounts(r);
    expect(c).toEqual({
      signedUp: 11,
      firstSession: 9,
      secondSession: 7,
      firstScoredCut: 6,
      measurable: 6,
      classifiable: 6,
      improving: c.improving,
    });
    const reached = r.stages.map((s) => s.reached);
    for (let i = 1; i < reached.length; i += 1) {
      expect(reached[i]).toBeLessThanOrEqual(reached[i - 1]);
    }
    expect(r.clamp).toEqual({
      measuredLearners: 8,
      outsideFunnel: 2,
      notInPopulation: 1,
      fewerThanTwoSessions: 1,
    });
  });

  it('counts scored-cut stages by scored cuts held, and splits the classifiable', () => {
    const cutLearners = groupCutRows(
      cohort(10, (u) => (u <= 3 ? 1 : u <= 6 ? 3 : 5)),
    );
    const r = buildEffectivenessFunnel({
      population: population(
        Array.from({ length: 10 }, (_, i) => [i + 1, 4] as [number, number]),
      ),
      cutLearners,
      ...FLOORS,
    });
    const c = stageCounts(r);
    expect(c.firstScoredCut).toBe(10);
    expect(c.measurable).toBe(7);
    expect(c.classifiable).toBe(4);
    expect(r.trend.classifiable).toBe(4);
    expect(
      r.trend.improving +
        r.trend.steady +
        r.trend.declining +
        r.trend.unclassified,
    ).toBe(4);
    expect(c.improving).toBe(r.trend.improving);
  });

  it('classifies exactly as Helping skills AAQ-181, with noise from EVERY measured learner', () => {
    const rows = cohort(
      30,
      (u) => 2 + (u % 7),
      (u) => (u % 3 === 0 ? 0.25 : u % 3 === 1 ? -0.2 : 0),
    );
    const cutLearners = groupCutRows(rows);
    // Only the first 20 are in the funnel: the trend of the other ten still
    // sizes the band, as it does on Helping skills.
    const r = buildEffectivenessFunnel({
      population: population(
        Array.from({ length: 20 }, (_, i) => [i + 1, 3] as [number, number]),
      ),
      cutLearners,
      ...FLOORS,
    });
    const progress = computeProgress(cutLearners, {
      sampleFloor: 20,
      minCohort: 5,
    });
    expect(r.helpingSkillsTrend).toEqual(progress.trend);
    expect(r.cutNoiseSd).toBe(progress.precision.cutNoiseSd);
    expect(r.trend.improving).toBeLessThanOrEqual(progress.trend.improving);
    expect(r.trend.declining).toBeLessThanOrEqual(progress.trend.declining);
  });

  it('withholds shares below the cohort floor and the improving split below the sample floor', () => {
    const small = buildEffectivenessFunnel({
      population: population([
        [1, 2],
        [2, 2],
        [3, 2],
        [4, 0],
      ]),
      cutLearners: groupCutRows(cohort(3, () => 4)),
      ...FLOORS,
    });
    // 4 signed up < 5: no share anywhere, counts still travel.
    expect(small.stages[0].reached).toBe(4);
    for (const s of small.stages) {
      expect(s.ofEnteredPct).toBeNull();
      expect(s.ofPreviousPct).toBeNull();
    }

    // 25 signed up, 12 classifiable: early shares shown, the improving split withheld.
    const mid = buildEffectivenessFunnel({
      population: population(
        Array.from({ length: 25 }, (_, i) => [i + 1, 2] as [number, number]),
      ),
      cutLearners: groupCutRows(
        cohort(
          12,
          () => 5,
          () => 0.3,
        ),
      ),
      ...FLOORS,
    });
    expect(mid.stages[0].ofEnteredPct).toBe(100);
    expect(mid.stages[0].ofPreviousPct).toBeNull();
    expect(mid.stages[1].ofPreviousPct).toBe(100);
    const classifiable = mid.stages.find((s) => s.key === 'classifiable');
    expect(classifiable?.reached).toBe(12);
    expect(classifiable?.ofEnteredPct).toBe(48);
    const improving = mid.stages.find((s) => s.key === 'improving');
    expect(improving?.ofEnteredPct).toBeNull();
    expect(improving?.ofPreviousPct).toBeNull();
    expect(mid.trend.improvingPct).toBeNull();
    expect(mid.trend.steadyPct).toBeNull();
    expect(mid.trend.decliningPct).toBeNull();

    // 24 classifiable: the improving split is stated.
    const big = buildEffectivenessFunnel({
      population: population(
        Array.from({ length: 30 }, (_, i) => [i + 1, 2] as [number, number]),
      ),
      cutLearners: groupCutRows(
        cohort(
          24,
          () => 6,
          () => 0.3,
        ),
      ),
      ...FLOORS,
    });
    const imp = big.stages.find((s) => s.key === 'improving');
    expect(big.trend.classifiable).toBe(24);
    expect(big.trend.improvingPct).not.toBeNull();
    expect(big.trend.improvingPct).toBeCloseTo(
      (big.trend.improving / 24) * 100,
      1,
    );
    // Of the previous (classifiable) stage = of the classifiable.
    expect(imp?.ofPreviousPct).toBe(big.trend.improvingPct);
  });

  it('withholds a step share whose previous stage is under the cohort floor', () => {
    const r = buildEffectivenessFunnel({
      population: population(
        Array.from(
          { length: 10 },
          (_, i) => [i + 1, i < 3 ? 2 : 0] as [number, number],
        ),
      ),
      cutLearners: groupCutRows(cohort(3, () => 2)),
      ...FLOORS,
    });
    const byKey = Object.fromEntries(r.stages.map((s) => [s.key, s]));
    expect(byKey.firstSession.reached).toBe(3);
    expect(byKey.firstSession.ofPreviousPct).toBe(30);
    // Previous stage holds 3 < 5 people: "100% of previous" would name them.
    expect(byKey.secondSession.ofPreviousPct).toBeNull();
    expect(byKey.secondSession.ofEnteredPct).toBe(30);
  });
});

/* -------------------------------------------------------------------------- */
/* EFF-03 · segments                                                          */
/* -------------------------------------------------------------------------- */

const segmentsFor = (
  rows: FoundationalSkillsLearnerCutRow[],
  dimension: SegmentDimension,
  context: SegmentContext = {},
  opts: {
    requestedCuts?: number;
    baselineFrom?: 1 | 2;
    sampleFloor?: number;
  } = {},
) => {
  const learners = groupCutRows(rows);
  const sampleFloor = opts.sampleFloor ?? 20;
  const panel = resolveSegmentPanel(learners, {
    requestedCuts: opts.requestedCuts,
    baselineFrom: opts.baselineFrom,
    sampleFloor,
    minCohort: 5,
  });
  return {
    learners,
    panel,
    result: buildSegments(learners, panel, {
      dimension,
      sampleFloor,
      context,
    }),
  };
};

const sessions = (
  entries: [string, Partial<SessionSegmentAttributes>][],
): Map<string, SessionSegmentAttributes> =>
  new Map(
    entries.map(([id, a]) => [
      id,
      {
        languageKey: null,
        languageLabel: null,
        difficulty: null,
        ...a,
      },
    ]),
  );

describe('segment overall row = Helping skills AAQ-168', () => {
  const rows = cohort(
    40,
    (u) => 2 + (u % 9),
    (u) => (u % 4 === 0 ? 0.2 : u % 4 === 1 ? -0.1 : 0.05),
  );

  it.each([
    [undefined, undefined],
    [undefined, 2 as const],
    [3, 1 as const],
    [6, 2 as const],
  ])('cuts=%s baselineFrom=%s', (requestedCuts, baselineFrom) => {
    const { learners, result } = segmentsFor(
      rows,
      'language',
      {},
      {
        requestedCuts,
        baselineFrom,
      },
    );
    const progress = computeProgress(learners, {
      requestedCuts,
      baselineFrom: baselineFrom ?? 1,
      sampleFloor: 20,
      minCohort: 5,
    });
    const c = progress.summary.composite;
    expect(result.cuts).toBe(progress.cuts);
    expect(result.windows).toEqual(progress.windows);
    expect(result.panelLearners).toBe(progress.summary.cohortLearners);
    expect(result.overall.change).not.toBeNull();
    expect(result.overall).toEqual({
      learners: c.n,
      earlyComposite: progress.summary.earlyComposite,
      lateComposite: progress.summary.lateComposite,
      change: c.change,
      ci: c.ci,
      up: c.up,
      down: c.down,
      tied: c.tied,
      signP: c.signP,
      detectable: c.detectable,
    });
  });

  it('segments partition the panel, most learners first', () => {
    const { result } = segmentsFor(
      rows,
      'workerType',
      {
        workerTypes: new Map(
          Array.from({ length: 40 }, (_, i) => [
            i + 1,
            i % 3 === 0
              ? 'LAY'
              : i % 3 === 1
                ? 'experienced_professional'
                : null,
          ]),
        ),
      },
      { sampleFloor: 5 },
    );
    const total =
      result.segments.reduce((a, s) => a + s.learners, 0) +
      result.withheld.reduce((a, s) => a + s.learners, 0);
    expect(total).toBe(result.panelLearners);
    const ns = result.segments.map((s) => s.learners);
    expect([...ns].sort((a, b) => b - a)).toEqual(ns);
  });
});

describe('segmentChange', () => {
  it('floors averages, change and CI but keeps the counts and the sign test', () => {
    const out = segmentChange([2, 2, 2], [3, 2, 1], 20);
    expect(out).toMatchObject({
      learners: 3,
      earlyComposite: null,
      lateComposite: null,
      change: null,
      ci: null,
      up: 1,
      down: 1,
      tied: 1,
      detectable: false,
    });
    expect(out.signP).toBe(1);
  });

  it('a floored-out segment goes to `withheld` with its count only', () => {
    const rows = cohort(25, () => 4);
    const { result } = segmentsFor(rows, 'workerType', {
      workerTypes: new Map(
        Array.from({ length: 25 }, (_, i) => [
          i + 1,
          i < 21 ? 'LAY' : 'EARLY_PROFESSIONAL',
        ]),
      ),
    });
    expect(result.segments.map((s) => [s.key, s.learners])).toEqual([
      ['LAY', 21],
    ]);
    expect(result.segments[0].change).not.toBeNull();
    expect(result.withheld).toEqual([
      { key: 'EARLY_PROFESSIONAL', label: 'Early professional', learners: 4 },
    ]);
  });
});

describe('segment assignment', () => {
  // Five learners × 4 cuts; floor 1 so every segment is shown.
  const keyOf = (
    result: ReturnType<typeof buildSegments>,
  ): Record<string, number> =>
    Object.fromEntries(
      [...result.segments, ...result.withheld].map((s) => [s.key, s.learners]),
    );
  const fourCuts = cohort(5, () => 4);

  it('language: majority over the distinct sessions of the panel cuts; tie → mixed; none → unknown', () => {
    const ctx: SegmentContext = {
      sessions: sessions([
        // learner 1: cuts 3 and 4 share session s-1-3, which votes once →
        // hi 2, en 1 → hi
        ['s-1-1', { languageKey: 'hi', languageLabel: 'Hindi' }],
        ['s-1-2', { languageKey: 'hi', languageLabel: 'Hindi' }],
        ['s-1-3', { languageKey: 'en', languageLabel: 'English' }],
        // learner 2: en, hi → tie
        ['s-2-1', { languageKey: 'en', languageLabel: 'English' }],
        ['s-2-2', { languageKey: 'hi', languageLabel: 'Hindi' }],
        // learner 3: one unresolvable + one en → en (unknowns do not vote)
        ['s-3-1', { languageKey: null }],
        ['s-3-2', { languageKey: 'en', languageLabel: 'English' }],
        // learner 4, 5: nothing resolvable → unknown
      ]),
    };
    const rows = fourCuts.map((r) =>
      r.userId === 1 && r.cut === 4 ? { ...r, sessionIds: ['s-1-3'] } : r,
    );
    const { result } = segmentsFor(rows, 'language', ctx, { sampleFloor: 1 });
    expect(keyOf(result)).toEqual({ hi: 1, mixed: 1, en: 1, unknown: 2 });
    const hi = result.segments.find((s) => s.key === 'hi');
    expect(hi?.label).toBe('Hindi');
  });

  it('difficulty: normalised majority; tie → mixed; unrecognised or missing → untagged', () => {
    const ctx: SegmentContext = {
      sessions: sessions([
        ['s-1-1', { difficulty: 'hard' }],
        ['s-1-2', { difficulty: ' HARD ' }],
        ['s-1-3', { difficulty: 'EASY' }],
        ['s-2-1', { difficulty: 'EASY' }],
        ['s-2-2', { difficulty: 'MEDIUM' }],
        ['s-3-1', { difficulty: 'EXPERT' }],
        ['s-4-1', { difficulty: 'MEDIUM' }],
      ]),
    };
    const { result } = segmentsFor(fourCuts, 'difficulty', ctx, {
      sampleFloor: 1,
    });
    expect(keyOf(result)).toEqual({
      HARD: 1,
      mixed: 1,
      untagged: 2,
      MEDIUM: 1,
    });
  });

  it('difficultyTransition: start-window majority → now-window majority', () => {
    // N = 4 → start = cuts 1–2, now = cuts 3–4.
    const ctx: SegmentContext = {
      sessions: sessions([
        ['s-1-1', { difficulty: 'EASY' }],
        ['s-1-2', { difficulty: 'EASY' }],
        ['s-1-3', { difficulty: 'HARD' }],
        ['s-1-4', { difficulty: 'HARD' }],
        ['s-2-1', { difficulty: 'HARD' }],
        ['s-2-3', { difficulty: 'HARD' }],
        ['s-3-1', { difficulty: 'EASY' }],
        ['s-3-2', { difficulty: 'HARD' }],
        ['s-3-3', { difficulty: 'MEDIUM' }],
      ]),
    };
    const { result, panel } = segmentsFor(
      fourCuts,
      'difficultyTransition',
      ctx,
      {
        sampleFloor: 1,
      },
    );
    expect(panel.windows).toEqual({ early: [1, 2], late: [3, 4], from: 1 });
    expect(keyOf(result)).toEqual({
      'EASY→HARD': 1,
      'HARD→HARD': 1,
      'mixed→MEDIUM': 1,
      'untagged→untagged': 2,
    });
    const row1 = result.segments.find((s) => s.key === 'EASY→HARD');
    expect(row1?.label).toBe('Easy → Hard');
  });

  it('workerType: the current admin-set value, normalised; absent or unknown → unset', () => {
    const { result } = segmentsFor(
      fourCuts,
      'workerType',
      {
        workerTypes: new Map<number, string | null>([
          [1, 'LAY'],
          [2, ' early_professional '],
          [3, 'NURSE'],
          [4, null],
        ]),
      },
      { sampleFloor: 1 },
    );
    expect(keyOf(result)).toEqual({ LAY: 1, EARLY_PROFESSIONAL: 1, unset: 3 });
  });

  it('orgSize: one org counted once under its uuid and its code; banded by measured learners', () => {
    // Org A: 12 learners, half of whose cuts carry the code 'acme' and half
    // the uuid — one org of 12 (10–49), not two of 6. Org B: 3 learners.
    const rows = [
      ...cohort(
        12,
        () => 4,
        undefined,
        (u) => ({
          tenantId: u % 2 ? 'acme' : 'uuid-a',
        }),
      ),
      ...cohort(3, () => 4).map((r) => ({
        ...r,
        userId: r.userId + 100,
        tenantId: 'uuid-b',
        sessionIds: [`s-${r.userId + 100}-${r.cut}`],
      })),
    ];
    const { result } = segmentsFor(
      rows,
      'orgSize',
      {
        tenantAliases: new Map([
          ['uuid-a', 'uuid-a'],
          ['acme', 'uuid-a'],
          ['uuid-b', 'uuid-b'],
        ]),
      },
      { sampleFloor: 1 },
    );
    expect(keyOf(result)).toEqual({ '10-49': 12, '1-9': 3 });
  });

  it('course: started a course strictly before the first now-window cut closed', () => {
    // N = 4 → first now cut = 3; learner u's cut 3 closes at T0 + (100u + 3) days.
    const close3 = (u: number) => new Date(T0 + (u * 100 + 3) * DAY);
    const { result } = segmentsFor(
      fourCuts,
      'course',
      {
        courseStarts: new Map([
          [1, new Date(close3(1).getTime() - DAY)],
          [2, close3(2)],
          [3, new Date(close3(3).getTime() + DAY)],
        ]),
      },
      { sampleFloor: 1 },
    );
    expect(keyOf(result)).toEqual({ course: 1, freePractice: 4 });
  });

  it('keeps FHS_PROGRESS_THRESHOLDS as the classifiable bar', () => {
    expect(FHS_PROGRESS_THRESHOLDS.trendMinCuts).toBe(4);
    const learners: EffectivenessLearner[] = groupCutRows(fourCuts);
    expect(learners.every((l) => l.cuts.length === 4)).toBe(true);
  });
});
