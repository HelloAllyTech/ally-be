import { FHS_RUBRIC } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  CompetenceLearner,
  PracticeOrdinalRow,
  RetentionCut,
  RetentionLearner,
  SessionTimes,
  TIER_COMPETENCE_EXCLUDED_SKILLS,
  TIER_COMPETENCE_SKILLS,
  buildPracticeProgression,
  competenceReaches,
  computeRetention,
  computeTimeToCompetence,
  cutGap,
  gapBand,
  kaplanMeier,
  median,
  reachKey,
  tierCompetenceSkillKeys,
  tierReach,
  tierSkillKeys,
} from '../foundational-skills-effectiveness.util';

/** A learner whose slice i+1 has `levels[i]`. */
const learner = (
  userId: number,
  levels: Record<string, number>[],
  firstCut = 1,
): CompetenceLearner => ({
  userId,
  cuts: levels.map((l, i) => ({ cut: firstCut + i, levels: l })),
});

const tier = (
  out: ReturnType<typeof computeTimeToCompetence>,
  name: string,
) => {
  const t = out.tiers.find((x) => x.tier === name);
  if (!t) throw new Error(`no tier ${name}`);
  return t;
};

describe('foundational-skills-effectiveness util', () => {
  describe('median', () => {
    it('handles empty, odd and even lists', () => {
      expect(median([])).toBeNull();
      expect(median([3, 1, 2])).toBe(2);
      expect(median([4, 1, 3, 2])).toBe(2.5);
    });
  });

  // ── Time to competence ────────────────────────────────────────────────────

  describe('TIER_COMPETENCE_SKILLS', () => {
    it('is every counted skill of the tier but one', () => {
      for (const t of ['engage', 'understand', 'support'] as const) {
        expect(TIER_COMPETENCE_SKILLS[t]).toBe(
          tierCompetenceSkillKeys(t).length - 1,
        );
      }
    });

    it('counts only the skills the rubric lets move (Engage 2 of 3, Understand 3 of 4, Support 2 of 3)', () => {
      expect([...TIER_COMPETENCE_EXCLUDED_SKILLS].sort()).toEqual([
        'confidentiality',
        'family',
        'harm',
        'rapport',
      ]);
      expect(TIER_COMPETENCE_SKILLS).toEqual({
        engage: 2,
        understand: 3,
        support: 2,
      });
    });

    it('tiers partition the rubric', () => {
      const keys = ['engage', 'understand', 'support'].flatMap((t) =>
        tierSkillKeys(t as 'engage'),
      );
      expect(keys.sort()).toEqual(FHS_RUBRIC.map((s) => s.key).sort());
    });
  });

  describe('tierReach', () => {
    it('accumulates skills across slices — they need not reach 3 together', () => {
      const r = tierReach(
        [
          { cut: 1, levels: { goals: 3, hope: 2 } },
          { cut: 2, levels: { goals: 2 } },
          { cut: 3, levels: { hope: 4 } },
        ],
        'support',
      );
      expect(r.firstReach).toEqual({ goals: 1, hope: 3, feedback: null });
      expect(r.assessed).toEqual({ goals: true, hope: true, feedback: false });
      // 2 of 3 by slice 3; the later 2 on goals does not undo slice 1.
      expect(r.competenceCut).toBe(3);
    });

    it('stays null until enough skills have each crossed', () => {
      const r = tierReach(
        [
          { cut: 1, levels: { goals: 3 } },
          { cut: 2, levels: { goals: 4, hope: 2, feedback: 2 } },
        ],
        'support',
      );
      expect(r.competenceCut).toBeNull();
    });

    it('reads cuts in index order whatever order they arrive in', () => {
      const r = tierReach(
        [
          { cut: 4, levels: { goals: 3 } },
          { cut: 2, levels: { goals: 3, hope: 3 } },
        ],
        'support',
      );
      expect(r.firstReach.goals).toBe(2);
      expect(r.competenceCut).toBe(2);
    });

    it('needs 2 of the 3 movable Engage skills, ignoring the excluded ones', () => {
      const two = { verbal: 3, feelings: 3 };
      expect(tierReach([{ cut: 1, levels: two }], 'engage').competenceCut).toBe(
        1,
      );
      // rapport, confidentiality and harm at 3 do not count toward Engage.
      const excludedOnly = {
        verbal: 3,
        rapport: 3,
        confidentiality: 3,
        harm: 3,
        empathy: 2,
      };
      expect(
        tierReach([{ cut: 1, levels: excludedOnly }], 'engage').competenceCut,
      ).toBeNull();
    });
  });

  describe('kaplanMeier', () => {
    it('removes censored learners from the at-risk count instead of counting them as never', () => {
      const pts = kaplanMeier([
        { lastCut: 3, eventCut: 1 }, // A
        { lastCut: 4, eventCut: 2 }, // B
        { lastCut: 2, eventCut: null }, // C stops at 2
        { lastCut: 3, eventCut: 3 }, // D
        { lastCut: 4, eventCut: null }, // E still going, not reached
      ]);
      expect(
        pts.map((p) => [p.cut, p.atRisk, p.reachedAtCut, p.censoredAtCut]),
      ).toEqual([
        [1, 5, 1, 0],
        [2, 4, 1, 1],
        [3, 2, 1, 0],
        [4, 1, 0, 1],
      ]);
      // 1 − (4/5)(3/4)(1/2) = 0.7 by cut 3 — the naive 3/5 = 0.6 would
      // count C, who stopped at cut 2, as "never".
      expect(pts.map((p) => +p.cumulative.toFixed(4))).toEqual([
        0.2, 0.4, 0.7, 0.7,
      ]);
    });

    it('is empty with no subjects and flat with no events', () => {
      expect(kaplanMeier([])).toEqual([]);
      const pts = kaplanMeier([
        { lastCut: 2, eventCut: null },
        { lastCut: 1, eventCut: null },
      ]);
      expect(pts.map((p) => p.cumulative)).toEqual([0, 0]);
      expect(pts.map((p) => p.atRisk)).toEqual([2, 1]);
    });
  });

  describe('computeTimeToCompetence', () => {
    // Support tier (goals, hope, feedback; 2 needed).
    const u1 = learner(1, [{ goals: 3, hope: 3 }]); // reaches at 1
    const u2 = learner(2, [{ goals: 3 }, { hope: 4 }]); // at 2
    const u3 = learner(3, [
      { goals: 2 },
      { goals: 2 },
      { goals: 3, feedback: 3 },
    ]); // at 3
    const u4 = learner(4, [{ goals: 2 }, { hope: 2 }, {}]); // never, last cut 3
    const late = learner(9, [{ goals: 3, hope: 3 }], 2); // no cut 1
    const all = [u1, u2, u3, u4, late];

    it('enters learners at their first slice and counts the rest', () => {
      const out = computeTimeToCompetence(all, {
        sampleFloor: 1,
        minCohort: 1,
      });
      expect(out.learners).toBe(4);
      expect(out.learnersWithoutFirstCut).toBe(1);
    });

    it('draws the KM curve and finds the median crossing', () => {
      const t = tier(
        computeTimeToCompetence(all, { sampleFloor: 1, minCohort: 1 }),
        'support',
      );
      expect(t.skillsRequired).toBe(2);
      expect(t.points.map((p) => [p.cut, p.atRisk, p.reachedShare])).toEqual([
        [1, 4, 25],
        [2, 3, 50],
        [3, 2, 75],
      ]);
      expect(t.points[2].censoredAtCut).toBe(1);
      expect(t.reachedLearners).toBe(3);
      expect(t.notReachedLearners).toBe(1);
      expect(t.medianCuts).toBe(2);
      expect(t.notReachedByHalf).toBe(false);
      expect(t.lastShownCut).toBe(3);
    });

    it('withholds shares below the sample floor and ends the axis at the cohort floor', () => {
      const t = tier(
        computeTimeToCompetence(all, { sampleFloor: 3, minCohort: 3 }),
        'support',
      );
      // atRisk 4, 3, 2 → the axis stops at cut 2 (last with ≥ 3 at risk)
      expect(t.points.map((p) => p.cut)).toEqual([1, 2]);
      expect(t.points.map((p) => p.reachedShare)).toEqual([25, 50]);
      expect(t.medianCuts).toBe(2);

      const t2 = tier(
        computeTimeToCompetence(all, { sampleFloor: 3, minCohort: 1 }),
        'support',
      );
      expect(t2.points.map((p) => p.reachedShare)).toEqual([25, 50, null]);
      expect(t2.lastShownCut).toBe(2);
    });

    it('says "not reached by half" only when shown points exist and none gets there', () => {
      const shownBelow = tier(
        computeTimeToCompetence(all, { sampleFloor: 4, minCohort: 1 }),
        'support',
      );
      expect(shownBelow.points.map((p) => p.reachedShare)).toEqual([
        25,
        null,
        null,
      ]);
      expect(shownBelow.medianCuts).toBeNull();
      expect(shownBelow.notReachedByHalf).toBe(true);
      expect(shownBelow.lastShownCut).toBe(1);

      const nothingShown = tier(
        computeTimeToCompetence(all, { sampleFloor: 10, minCohort: 1 }),
        'support',
      );
      expect(nothingShown.medianCuts).toBeNull();
      expect(nothingShown.notReachedByHalf).toBe(false);
      expect(nothingShown.lastShownCut).toBeNull();
    });

    it('returns no points when fewer than the cohort floor ever were at risk', () => {
      const t = tier(
        computeTimeToCompetence([u1, u2], { sampleFloor: 1, minCohort: 5 }),
        'support',
      );
      expect(t.points).toEqual([]);
      expect(t.reachedLearners).toBe(2);
    });

    it('takes median minutes over reachers, withheld below the floor', () => {
      const minutes = new Map([
        [reachKey(1, 1), 30],
        [reachKey(2, 2), 50],
        [reachKey(3, 3), 70],
      ]);
      const shown = tier(
        computeTimeToCompetence(all, { sampleFloor: 3, minCohort: 1, minutes }),
        'support',
      );
      expect(shown.medianMinutes).toBe(50);
      expect(shown.minutesLearners).toBe(3);
      const withheld = tier(
        computeTimeToCompetence(all, { sampleFloor: 4, minCohort: 1, minutes }),
        'support',
      );
      expect(withheld.medianMinutes).toBeNull();
      expect(withheld.minutesLearners).toBe(3);
    });

    it('names the skill not-yet-reached learners most often lack, split by never assessed vs below 3', () => {
      const n1 = learner(11, [{ goals: 3 }]);
      const n2 = learner(12, [{ goals: 3, hope: 2 }]);
      const n3 = learner(13, [{ hope: 2 }]);
      const t = tier(
        computeTimeToCompetence([n1, n2, n3], { sampleFloor: 1, minCohort: 3 }),
        'support',
      );
      expect(t.missing.learners).toBe(3);
      expect(
        t.missing.skills.map((s) => [
          s.skill,
          s.missingLearners,
          s.neverAssessed,
          s.assessedBelow,
          s.sharePct,
        ]),
      ).toEqual([
        // hope and feedback tie at 3 → rubric order
        ['hope', 3, 1, 2, 100],
        ['feedback', 3, 3, 0, 100],
        ['goals', 1, 1, 0, 33.3],
      ]);
      expect(t.missing.mostOftenMissing).toBe('hope');

      const small = tier(
        computeTimeToCompetence([n1, n2, n3], { sampleFloor: 1, minCohort: 5 }),
        'support',
      );
      expect(small.missing.mostOftenMissing).toBeNull();
      expect(small.missing.skills.every((s) => s.sharePct === null)).toBe(true);
      expect(small.missing.skills[0].missingLearners).toBe(3);
    });

    it('returns all three tiers and a zero-sized result for no data', () => {
      const out = computeTimeToCompetence([], {
        sampleFloor: 20,
        minCohort: 5,
      });
      expect(out.tiers.map((t) => t.tier)).toEqual([
        'engage',
        'understand',
        'support',
      ]);
      expect(out.learners).toBe(0);
      expect(out.maxCut).toBe(0);
      expect(out.tiers[0].points).toEqual([]);
      expect(out.tiers[0].medianMinutes).toBeNull();
    });
  });

  describe('competenceReaches', () => {
    it('lists each entered learner’s competence cuts once, across tiers', () => {
      const both = learner(1, [
        {
          goals: 3,
          hope: 3,
          functioning: 3,
          explanation: 3,
          coping: 3,
          psychoeducation: 3,
        },
      ]);
      expect(competenceReaches([both])).toEqual([{ userId: 1, cut: 1 }]);
      expect(
        competenceReaches([learner(2, [{ goals: 3, hope: 3 }], 2)]),
      ).toEqual([]);
    });
  });

  // ── Retention ─────────────────────────────────────────────────────────────

  describe('gapBand', () => {
    it.each([
      [-2, '<7'],
      [0, '<7'],
      [6.999, '<7'],
      [7, '7-13'],
      [13.99, '7-13'],
      [14, '14-29'],
      [29.99, '14-29'],
      [30, '30+'],
      [400, '30+'],
    ])('%d days → %s', (days, band) => {
      expect(gapBand(days)).toBe(band);
    });
  });

  const D = (day: number, hour = 0) =>
    new Date(Date.UTC(2026, 0, 1 + day, hour));
  const rc = (
    cut: number,
    score: number,
    sessionIds: string[],
    unhelpful: boolean | null = false,
  ): RetentionCut => ({ cut, score, unhelpful, sessionIds });

  describe('cutGap', () => {
    const times = new Map<string, SessionTimes>([
      ['a', { startedAt: D(0, 9), endedAt: D(0, 10) }],
      ['b', { startedAt: D(0, 11), endedAt: D(0, 12) }],
      ['c', { startedAt: D(10, 12), endedAt: D(10, 13) }],
      ['early', { startedAt: D(0, 8), endedAt: D(0, 14) }],
      ['nostart', { startedAt: null, endedAt: D(5) }],
    ]);

    it('measures end of the last session before to start of the first new one', () => {
      // Cut 2 shares session b with cut 1 (it closed mid-session) and then
      // continues in c: b is not "new", so the gap runs b.end → c.start.
      const g = cutGap(rc(1, 2, ['a', 'b']), rc(2, 2, ['b', 'c']), times);
      expect(g).toEqual({ kind: 'gap', days: 10, overlapped: false });
    });

    it('clamps overlapping sessions to a zero gap and flags them', () => {
      // `early` started before b ended (two roleplays open at once).
      const g = cutGap(rc(1, 2, ['a', 'b']), rc(2, 2, ['early']), times);
      expect(g).toEqual({ kind: 'gap', days: 0, overlapped: true });
    });

    it('has no gap when the next cut lies inside sessions already seen', () => {
      expect(cutGap(rc(1, 2, ['a', 'b']), rc(2, 2, ['b']), times)).toEqual({
        kind: 'sameSession',
      });
    });

    it('reports missing times rather than guessing', () => {
      expect(cutGap(rc(1, 2, ['a']), rc(2, 2, ['nostart']), times)).toEqual({
        kind: 'missingTimes',
      });
      expect(cutGap(rc(1, 2, ['gone']), rc(2, 2, ['c']), times)).toEqual({
        kind: 'missingTimes',
      });
    });
  });

  describe('computeRetention', () => {
    /** Sessions s<id> one hour long, starting on day `day`. */
    const timesFor = (
      spec: Record<string, number>,
    ): Map<string, SessionTimes> =>
      new Map(
        Object.entries(spec).map(([id, day]) => [
          id,
          { startedAt: D(day, 9), endedAt: D(day, 10) },
        ]),
      );

    it('collapses to one value per learner before the bootstrap', () => {
      // A: three short-gap pairs, each +1. B: one short-gap pair, −1.
      const A: RetentionLearner = {
        userId: 1,
        cuts: [
          rc(1, 1, ['a1']),
          rc(2, 2, ['a2']),
          rc(3, 3, ['a3']),
          rc(4, 4, ['a4']),
        ],
      };
      const B: RetentionLearner = {
        userId: 2,
        cuts: [rc(1, 3, ['b1']), rc(2, 2, ['b2'])],
      };
      const times = timesFor({ a1: 0, a2: 1, a3: 2, a4: 3, b1: 0, b2: 2 });
      const out = computeRetention([A, B], times, {
        minPairs: 1,
        minLearners: 1,
      });
      const short = out.bands.find((b) => b.band === '<7');
      expect(short?.reference).toBe(true);
      expect(short?.composite.pairs).toBe(4);
      expect(short?.composite.learners).toBe(2);
      // Per learner: A = +1, B = −1 → 0. The per-pair mean would be +0.5.
      expect(short?.composite.change).toBe(0);
      expect(short?.composite.up).toBe(1);
      expect(short?.composite.down).toBe(1);
      expect(out.pairs.plotted).toBe(4);
      expect(out.learners).toBe(2);
    });

    it('bands each pair by its gap and counts what it cannot plot', () => {
      const L: RetentionLearner = {
        userId: 1,
        cuts: [
          rc(1, 2, ['x1']),
          rc(2, 2.5, ['x2']), // day 0 → day 10: 7-13
          rc(3, 2, ['x2']), // inside x2 again: sameSession
          rc(5, 3, ['x5']), // 3 → 5: nonAdjacent
          rc(6, 3.5, ['x6']), // day 40 → day 80: 30+
          rc(7, 3, ['missing']), // no times
        ],
      };
      const times = timesFor({ x1: 0, x2: 10, x5: 40, x6: 80 });
      const out = computeRetention([L], times, {
        minPairs: 1,
        minLearners: 1,
      });
      expect(out.pairs).toEqual({
        considered: 5,
        nonAdjacent: 1,
        sameSession: 1,
        missingTimes: 1,
        overlapping: 0,
        plotted: 2,
      });
      const byBand = Object.fromEntries(
        out.bands.map((b) => [b.band, b.composite.pairs]),
      );
      expect(byBand).toEqual({ '<7': 0, '7-13': 1, '14-29': 0, '30+': 1 });
      const mid = out.bands.find((b) => b.band === '7-13');
      expect(mid?.composite.change).toBe(0.5);
      // 9 days 23 hours: end of x1 (day 0, 10:00) to start of x2 (day 10, 09:00)
      expect(mid?.medianGapDays).toBe(10);
      expect(out.takeaway.longBreakBand).toBe('30+');
      expect(out.takeaway.longBreakChange).toBe(0.5);
      expect(out.takeaway.referenceChange).toBeNull();
    });

    it('withholds a band below the pair floor OR the learner floor, keeping counts', () => {
      // 3 learners × 8 short-gap pairs = 24 pairs, but only 3 learners.
      const learners: RetentionLearner[] = [1, 2, 3].map((u) => ({
        userId: u,
        cuts: Array.from({ length: 9 }, (_, i) =>
          rc(i + 1, 2 + (i % 2) * 0.5, [`u${u}s${i}`]),
        ),
      }));
      const spec: Record<string, number> = {};
      for (const u of [1, 2, 3])
        for (let i = 0; i < 9; i += 1) spec[`u${u}s${i}`] = i;
      const times = timesFor(spec);

      const out = computeRetention(learners, times, {
        minPairs: 20,
        minLearners: 10,
      });
      const short = out.bands.find((b) => b.band === '<7');
      expect(short?.composite.pairs).toBe(24);
      expect(short?.composite.learners).toBe(3);
      expect(short?.composite.measurable).toBe(false);
      expect(short?.composite.change).toBeNull();
      expect(short?.composite.ci).toBeNull();
      expect(short?.composite.signP).toBeNull();
      expect(short?.composite.detectable).toBe(false);
      expect(short?.medianGapDays).toBeNull();

      const shown = computeRetention(learners, times, {
        minPairs: 20,
        minLearners: 3,
      });
      expect(
        shown.bands.find((b) => b.band === '<7')?.composite.measurable,
      ).toBe(true);
    });

    it('tracks the unhelpful share in percentage points, over coded pairs only', () => {
      const L: RetentionLearner = {
        userId: 1,
        cuts: [
          rc(1, 2, ['a'], true),
          rc(2, 2, ['b'], false), // −100
          rc(3, 2, ['c'], null), // uncoded: skipped for unhelpful
        ],
      };
      const out = computeRetention([L], timesFor({ a: 0, b: 1, c: 2 }), {
        minPairs: 1,
        minLearners: 1,
      });
      const short = out.bands.find((b) => b.band === '<7');
      expect(short?.composite.pairs).toBe(2);
      expect(short?.unhelpful.pairs).toBe(1);
      expect(short?.unhelpful.change).toBe(-100);
    });

    it('returns all four bands, withheld, with no data', () => {
      const out = computeRetention([], new Map(), {
        minPairs: 20,
        minLearners: 10,
      });
      expect(out.bands.map((b) => b.band)).toEqual([
        '<7',
        '7-13',
        '14-29',
        '30+',
      ]);
      expect(out.bands.every((b) => b.composite.change === null)).toBe(true);
      expect(out.learners).toBe(0);
    });
  });

  // ── Practice progression ──────────────────────────────────────────────────

  describe('buildPracticeProgression', () => {
    const row = (
      ordinal: number,
      difficulty: string,
      sessions: number,
      experiencedSessions = 0,
    ): PracticeOrdinalRow => ({
      ordinal,
      difficulty,
      sessions,
      experiencedSessions,
    });

    it('turns counts into shares above the floor and keeps every ordinal', () => {
      const out = buildPracticeProgression(
        [
          row(1, 'EASY', 10, 4),
          row(1, 'MEDIUM', 8, 1),
          row(1, 'untagged', 2),
          row(2, 'HARD', 3, 3),
          row(2, 'weird-legacy', 1), // unknown label → untagged
          row(13, 'HARD', 99), // beyond the axis: ignored
        ],
        { maxOrdinal: 3, sampleFloor: 20 },
      );
      expect(out.ordinals.map((o) => o.ordinal)).toEqual([1, 2, 3]);
      expect(out.learners).toBe(20);
      expect(out.experiencedLearners).toBe(5);

      const [o1, o2, o3] = out.ordinals;
      expect(o1.sessions).toBe(20);
      expect(o1.counts).toEqual({ EASY: 10, MEDIUM: 8, HARD: 0, untagged: 2 });
      expect(o1.shares).toEqual({
        EASY: 50,
        MEDIUM: 40,
        HARD: 0,
        untagged: 10,
      });
      // Below the floor: counts travel, shares do not.
      expect(o1.experienced.counts.EASY).toBe(4);
      expect(o1.experienced.shares.EASY).toBeNull();
      expect(o2.counts).toEqual({ EASY: 0, MEDIUM: 0, HARD: 3, untagged: 1 });
      expect(o2.shares.HARD).toBeNull();
      // Nobody reached ordinal 3: zero counts, null (not 0%) shares.
      expect(o3.sessions).toBe(0);
      expect(o3.shares).toEqual({
        EASY: null,
        MEDIUM: null,
        HARD: null,
        untagged: null,
      });
    });

    it('is empty-but-complete with no rows', () => {
      const out = buildPracticeProgression([], {
        maxOrdinal: 12,
        sampleFloor: 20,
      });
      expect(out.ordinals).toHaveLength(12);
      expect(out.learners).toBe(0);
    });
  });
});
