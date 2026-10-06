import {
  FlooredPairedComparison,
  flooredPairedComparison,
} from './paired-stats.util';
import { singleScenarioOf } from './scenario-effectiveness.util';

/**
 * Transfer to a new scenario (EFF-14, AAQ-220): when a learner meets a
 * scenario they have never played, do they bring their helping skills with
 * them?
 *
 * The comparison, per learner, on the foundational helping skills composite
 * (R1, 1–4):
 *
 *  - Only SINGLE-SCENARIO cuts are compared — every session in the cut played
 *    one scenario (`singleScenarioOf`, the same rule as AAQ-214). A cut that
 *    crosses scenarios says nothing about either.
 *  - Walking a learner's single-scenario cuts in cut order, a cut is **new**
 *    when its scenario appears in none of their EARLIER cuts — single-scenario
 *    or mixed, scored or not, because a scenario met inside a mixed or
 *    unscored cut has still been played. It is **repeated** when it does.
 *  - A pair is formed when a new cut's IMMEDIATELY preceding single-scenario
 *    cut was a repeated one, both scored: (repeated composite → new
 *    composite). The repeated cut is the learner's level on familiar material
 *    just before the switch; the new cut is the same learner, minutes of
 *    practice later, on material they have never seen.
 *  - Only learners with at least {@link TRANSFER_MIN_SINGLE_SCENARIO_CUTS}
 *    scored single-scenario cuts take part (the plan's population).
 *  - Several pairs from one learner collapse to their mean first, so the
 *    paired statistics are over PEOPLE, never over pairs.
 *
 * Pure, so the pairing rules and every floor are unit-tested without a
 * database.
 */

/** Scored single-scenario cuts a learner needs to enter the comparison. */
export const TRANSFER_MIN_SINGLE_SCENARIO_CUTS = 3;

/** Authoring difficulty, ranked, for the difficulty-shift tally. */
const DIFFICULTY_RANK: Readonly<Record<string, number>> = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
};

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** One sealed cut with the scenario of each session it touches. */
export interface TransferCutRow {
  userId: number;
  cut: number;
  /** Composite under the pinned rubric; null when the cut is not scored. */
  score: number | null;
  /** Consumption order. `scenarioId` null = session or scenario not found. */
  sessions: {
    sessionId: string;
    scenarioId: number | null;
    difficulty: string | null;
  }[];
}

export type DifficultyShift = 'harder' | 'same' | 'easier' | 'untagged';

export interface TransferPair {
  learnerId: number;
  repeatedCut: number;
  newCut: number;
  repeatedScenarioId: number;
  newScenarioId: number;
  repeatedScore: number;
  newScore: number;
  difficultyShift: DifficultyShift;
}

export interface TransferLearnerOut {
  learnerId: number;
  /** Mean composite of the learner's repeated cuts that opened a pair. */
  before: number;
  /** Mean composite of the new-scenario cuts those pairs closed on. */
  after: number;
  change: number;
  pairs: number;
}

export interface TransferComputation {
  learnersMeasured: number;
  scoredCuts: number;
  singleScenarioCuts: number;
  singleScenarioSharePct: number | null;
  learnersEligible: number;
  learnersWithPair: number;
  pairs: number;
  comparison: FlooredPairedComparison;
  sameDifficulty: FlooredPairedComparison;
  difficultyShift: Record<DifficultyShift, number>;
  learners: TransferLearnerOut[] | null;
}

function shiftOf(from: string | null, to: string | null): DifficultyShift {
  const a = from ? DIFFICULTY_RANK[from] : undefined;
  const b = to ? DIFFICULTY_RANK[to] : undefined;
  if (a === undefined || b === undefined) return 'untagged';
  if (b > a) return 'harder';
  if (b < a) return 'easier';
  return 'same';
}

/**
 * The (repeated → new) pairs of ONE learner, from their cuts in any order.
 * Also returns how many scored single-scenario cuts they have, for the
 * eligibility rule.
 */
export function transferPairsFor(cuts: readonly TransferCutRow[]): {
  pairs: TransferPair[];
  scoredSingleCuts: number;
} {
  const ordered = [...cuts].sort((a, b) => a.cut - b.cut);
  const seen = new Set<number>();
  const pairs: TransferPair[] = [];
  let scoredSingleCuts = 0;
  let prev: {
    cut: number;
    scenarioId: number;
    score: number | null;
    repeated: boolean;
    difficulty: string | null;
  } | null = null;

  for (const c of ordered) {
    const sessionIds = c.sessions.map((s) => s.sessionId);
    const scenarioBySession = new Map(
      c.sessions.map((s) => [s.sessionId, s.scenarioId]),
    );
    const scenarioId = singleScenarioOf(sessionIds, scenarioBySession);
    if (scenarioId !== null) {
      const isNew = !seen.has(scenarioId);
      const difficulty =
        c.sessions.find((s) => s.scenarioId === scenarioId)?.difficulty ?? null;
      if (c.score !== null) {
        scoredSingleCuts += 1;
        if (isNew && prev && prev.repeated && prev.score !== null) {
          pairs.push({
            learnerId: c.userId,
            repeatedCut: prev.cut,
            newCut: c.cut,
            repeatedScenarioId: prev.scenarioId,
            newScenarioId: scenarioId,
            repeatedScore: prev.score,
            newScore: c.score,
            difficultyShift: shiftOf(prev.difficulty, difficulty),
          });
        }
      }
      // Strict adjacency among single-scenario cuts: an unscored one in
      // between breaks the pair rather than being skipped over.
      prev = {
        cut: c.cut,
        scenarioId,
        score: c.score,
        repeated: !isNew,
        difficulty,
      };
    }
    // Everything this cut touched is now "played", whatever its shape.
    for (const s of c.sessions) {
      if (s.scenarioId !== null) seen.add(s.scenarioId);
    }
  }
  return { pairs, scoredSingleCuts };
}

/** Collapse each learner's pairs to one (before, after), learners sorted by id. */
function collapse(
  pairsByLearner: ReadonlyMap<number, readonly TransferPair[]>,
): TransferLearnerOut[] {
  const out: TransferLearnerOut[] = [];
  for (const [learnerId, pairs] of pairsByLearner) {
    if (pairs.length === 0) continue;
    const before = mean(pairs.map((p) => p.repeatedScore));
    const after = mean(pairs.map((p) => p.newScore));
    out.push({
      learnerId,
      before,
      after,
      change: after - before,
      pairs: pairs.length,
    });
  }
  return out.sort((a, b) => a.learnerId - b.learnerId);
}

export function buildTransfer(
  rows: readonly TransferCutRow[],
  opts: { floor: number; minSingleCuts?: number },
): TransferComputation {
  const minSingle = opts.minSingleCuts ?? TRANSFER_MIN_SINGLE_SCENARIO_CUTS;
  const byLearner = new Map<number, TransferCutRow[]>();
  for (const r of rows) {
    const list = byLearner.get(r.userId) ?? [];
    list.push(r);
    byLearner.set(r.userId, list);
  }

  let scoredCuts = 0;
  let singleScenarioCuts = 0;
  let learnersMeasured = 0;
  let learnersEligible = 0;
  const pairsByLearner = new Map<number, TransferPair[]>();
  for (const [learnerId, cuts] of byLearner) {
    const scored = cuts.filter((c) => c.score !== null).length;
    scoredCuts += scored;
    if (scored > 0) learnersMeasured += 1;
    const { pairs, scoredSingleCuts } = transferPairsFor(cuts);
    singleScenarioCuts += scoredSingleCuts;
    if (scoredSingleCuts < minSingle) continue;
    learnersEligible += 1;
    if (pairs.length) pairsByLearner.set(learnerId, pairs);
  }

  const learners = collapse(pairsByLearner);
  const allPairs = [...pairsByLearner.values()].flat();
  const comparison = flooredPairedComparison(
    learners.map((l) => l.before),
    learners.map((l) => l.after),
    opts.floor,
  );

  // Robustness read for the difficulty confound: the same comparison over
  // pairs whose two scenarios carry the SAME authoring difficulty.
  const sameByLearner = new Map<number, TransferPair[]>();
  for (const [id, pairs] of pairsByLearner) {
    const same = pairs.filter((p) => p.difficultyShift === 'same');
    if (same.length) sameByLearner.set(id, same);
  }
  const sameLearners = collapse(sameByLearner);
  const sameDifficulty = flooredPairedComparison(
    sameLearners.map((l) => l.before),
    sameLearners.map((l) => l.after),
    opts.floor,
  );

  const difficultyShift: Record<DifficultyShift, number> = {
    harder: 0,
    same: 0,
    easier: 0,
    untagged: 0,
  };
  for (const p of allPairs) difficultyShift[p.difficultyShift] += 1;

  const shown = learners.length >= opts.floor;
  return {
    learnersMeasured,
    scoredCuts,
    singleScenarioCuts,
    singleScenarioSharePct: scoredCuts
      ? round1((singleScenarioCuts / scoredCuts) * 100)
      : null,
    learnersEligible,
    learnersWithPair: learners.length,
    pairs: allPairs.length,
    comparison,
    sameDifficulty,
    difficultyShift,
    learners: shown
      ? learners
          .map((l) => ({
            learnerId: l.learnerId,
            before: round2(l.before),
            after: round2(l.after),
            change: round2(l.change),
            pairs: l.pairs,
          }))
          .sort((a, b) => b.change - a.change || a.learnerId - b.learnerId)
      : null,
  };
}
