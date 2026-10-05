import {
  TRANSFER_MIN_SINGLE_SCENARIO_CUTS,
  TransferCutRow,
  buildTransfer,
  transferPairsFor,
} from '../foundational-skills-transfer.util';

const DIFF: Record<number, string | null> = {
  1: 'EASY',
  2: 'EASY',
  3: 'MEDIUM',
  4: 'HARD',
  9: null,
};

/**
 * One cut of learner `userId`: `scenarios` lists the scenario of each session
 * in it (null = session not found). `score` null = sealed but not scored.
 */
const cut = (
  userId: number,
  k: number,
  score: number | null,
  scenarios: (number | null)[],
): TransferCutRow => ({
  userId,
  cut: k,
  score,
  sessions: scenarios.map((scenarioId, i) => ({
    sessionId: `u${userId}-c${k}-s${i}`,
    scenarioId,
    difficulty: scenarioId === null ? null : (DIFF[scenarioId] ?? null),
  })),
});

describe('foundational-skills-transfer util', () => {
  it('needs three scored single-scenario cuts', () => {
    expect(TRANSFER_MIN_SINGLE_SCENARIO_CUTS).toBe(3);
  });

  describe('transferPairsFor — the pairing rules', () => {
    it('pairs a new scenario with the repeated cut just before it', () => {
      const { pairs, scoredSingleCuts } = transferPairsFor([
        cut(1, 1, 2.0, [1]), // A new (nothing before → no pair)
        cut(1, 2, 2.4, [1]), // A repeated
        cut(1, 3, 2.1, [2]), // B new, after a repeated cut → PAIR
        cut(1, 4, 2.5, [2]), // B repeated
        cut(1, 5, 2.6, [2]), // B repeated
      ]);
      expect(scoredSingleCuts).toBe(5);
      expect(pairs).toEqual([
        {
          learnerId: 1,
          repeatedCut: 2,
          newCut: 3,
          repeatedScenarioId: 1,
          newScenarioId: 2,
          repeatedScore: 2.4,
          newScore: 2.1,
          difficultyShift: 'same',
        },
      ]);
    });

    it('does not pair new after new', () => {
      const { pairs } = transferPairsFor([
        cut(1, 1, 2, [1]), // A new
        cut(1, 2, 2, [2]), // B new — preceded by a NEW cut, not a repeated one
        cut(1, 3, 2, [3]), // C new — same
      ]);
      expect(pairs).toEqual([]);
    });

    it('counts a scenario met inside a mixed cut as played', () => {
      const { pairs } = transferPairsFor([
        cut(1, 1, 2, [1]),
        cut(1, 2, 2, [1, 2]), // mixed: B is now "played"
        cut(1, 3, 2, [1]), // A repeated
        cut(1, 4, 2, [2]), // B — NOT new
      ]);
      expect(pairs).toEqual([]);
    });

    it('counts a scenario met in an unscored cut as played', () => {
      const { pairs, scoredSingleCuts } = transferPairsFor([
        cut(1, 1, 2, [1]),
        cut(1, 2, null, [2]), // B played, scoring failed
        cut(1, 3, 2, [1]), // A repeated
        cut(1, 4, 2, [2]), // B — not new
      ]);
      expect(pairs).toEqual([]);
      expect(scoredSingleCuts).toBe(3);
    });

    it('lets an unscored single-scenario cut break adjacency', () => {
      const { pairs } = transferPairsFor([
        cut(1, 1, 2, [1]),
        cut(1, 2, 2, [1]), // A repeated, scored
        cut(1, 3, null, [1]), // A repeated, UNSCORED — the immediate predecessor
        cut(1, 4, 2, [2]), // B new, but its predecessor has no score
      ]);
      expect(pairs).toEqual([]);
    });

    it('skips mixed cuts when looking for the preceding single-scenario cut', () => {
      const { pairs } = transferPairsFor([
        cut(1, 1, 2.0, [1]),
        cut(1, 2, 2.2, [1]), // A repeated
        cut(1, 3, 2.9, [1, 3]), // mixed A + C: never paired
        cut(1, 4, 1.8, [2]), // B new; preceding SINGLE cut is cut 2
      ]);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]).toMatchObject({ repeatedCut: 2, newCut: 4 });
    });

    it('never attributes a cut with an unknown session', () => {
      const { pairs, scoredSingleCuts } = transferPairsFor([
        cut(1, 1, 2, [1]),
        cut(1, 2, 2, [1]),
        cut(1, 3, 2, [2, null]), // B + unknown: not single-scenario
      ]);
      expect(scoredSingleCuts).toBe(2);
      expect(pairs).toEqual([]);
    });

    it('orders by cut index whatever order rows arrive in', () => {
      const rows = [
        cut(1, 3, 2.1, [2]),
        cut(1, 1, 2.0, [1]),
        cut(1, 2, 2.4, [1]),
      ];
      expect(transferPairsFor(rows).pairs).toHaveLength(1);
    });

    it('tallies how the difficulty tag moved', () => {
      const { pairs } = transferPairsFor([
        cut(1, 1, 2, [1]),
        cut(1, 2, 2, [1]), // EASY repeated
        cut(1, 3, 2, [4]), // HARD new → harder
        cut(1, 4, 2, [4]), // HARD repeated
        cut(1, 5, 2, [3]), // MEDIUM new → easier
        cut(1, 6, 2, [3]),
        cut(1, 7, 2, [9]), // untagged new → untagged
      ]);
      expect(pairs.map((p) => p.difficultyShift)).toEqual([
        'harder',
        'easier',
        'untagged',
      ]);
    });
  });

  describe('buildTransfer', () => {
    /** A learner with one pair: repeated `before`, then new `after`. */
    const paired = (userId: number, before: number, after: number) => [
      cut(userId, 1, before, [1]),
      cut(userId, 2, before, [1]),
      cut(userId, 3, after, [2]),
    ];

    it('collapses several pairs to one value per learner before any statistic', () => {
      const rows = [
        cut(1, 1, 2.0, [1]),
        cut(1, 2, 2.0, [1]), // repeated
        cut(1, 3, 1.0, [2]), // new: −1.0
        cut(1, 4, 2.0, [2]), // repeated
        cut(1, 5, 2.0, [3]), // new: 0.0 → learner mean −0.5
        ...paired(2, 2.0, 2.5), // +0.5
      ];
      const out = buildTransfer(rows, { floor: 2 });
      expect(out.pairs).toBe(3);
      expect(out.learnersWithPair).toBe(2);
      expect(out.comparison).toMatchObject({
        n: 2,
        beforeAvg: 2,
        afterAvg: 2,
        change: 0,
        up: 1,
        down: 1,
      });
      expect(out.learners).toEqual([
        { learnerId: 2, before: 2, after: 2.5, change: 0.5, pairs: 1 },
        { learnerId: 1, before: 2, after: 1.5, change: -0.5, pairs: 2 },
      ]);
    });

    it('leaves out learners with fewer than three scored single-scenario cuts', () => {
      const rows = [
        // Learner 1: a pair, but only 2 single-scenario cuts → not eligible.
        cut(1, 1, 2, [1]),
        cut(1, 2, 2, [1]),
        cut(1, 3, 2, [1, 2]),
        // Learner 2: eligible, with a pair.
        ...paired(2, 2, 2.5),
      ];
      const out = buildTransfer(rows, { floor: 1 });
      expect(out.learnersMeasured).toBe(2);
      expect(out.learnersEligible).toBe(1);
      expect(out.learnersWithPair).toBe(1);
      expect(out.scoredCuts).toBe(6);
      expect(out.singleScenarioCuts).toBe(5);
      expect(out.singleScenarioSharePct).toBe(83.3);
    });

    it('withholds every statistic and the learner rows below the floor, keeping counts', () => {
      const rows = Array.from({ length: 19 }, (_, i) =>
        paired(i + 1, 2, 2.3),
      ).flat();
      const out = buildTransfer(rows, { floor: 20 });
      expect(out.learnersWithPair).toBe(19);
      expect(out.pairs).toBe(19);
      expect(out.comparison).toMatchObject({
        n: 19,
        beforeAvg: null,
        afterAvg: null,
        change: null,
        changeCi: null,
        signP: null,
        detectable: false,
        up: 19,
      });
      expect(out.learners).toBeNull();
    });

    it('states the change, CI and test from the floor up', () => {
      const rows = Array.from({ length: 20 }, (_, i) =>
        paired(i + 1, 2, i % 4 ? 1.7 : 2.1),
      ).flat();
      const out = buildTransfer(rows, { floor: 20 });
      expect(out.comparison.n).toBe(20);
      expect(out.comparison.change).toBe(-0.2);
      expect(out.comparison.changeCi).not.toBeNull();
      expect(out.comparison.detectable).toBe(true);
      expect(out.comparison.signP).not.toBeNull();
      expect(out.learners).toHaveLength(20);
      const changes = out.learners!.map((l) => l.change);
      expect(changes).toEqual([...changes].sort((a, b) => b - a));
    });

    it('runs the same comparison over same-difficulty pairs only', () => {
      const rows = [
        ...paired(1, 2, 2.4), // 1 → 2: EASY → EASY (same)
        cut(2, 1, 2, [1]),
        cut(2, 2, 2, [1]),
        cut(2, 3, 1.5, [4]), // EASY → HARD (harder)
      ];
      const out = buildTransfer(rows, { floor: 1 });
      expect(out.difficultyShift).toEqual({
        harder: 1,
        same: 1,
        easier: 0,
        untagged: 0,
      });
      expect(out.comparison.n).toBe(2);
      expect(out.sameDifficulty).toMatchObject({ n: 1, change: 0.4 });
    });

    it('is all zeros and nulls with no data, never a 0 for an unknown share', () => {
      const out = buildTransfer([], { floor: 20 });
      expect(out).toMatchObject({
        learnersMeasured: 0,
        scoredCuts: 0,
        singleScenarioCuts: 0,
        singleScenarioSharePct: null,
        learnersEligible: 0,
        learnersWithPair: 0,
        pairs: 0,
        learners: null,
      });
      expect(out.comparison.change).toBeNull();
    });
  });
});
