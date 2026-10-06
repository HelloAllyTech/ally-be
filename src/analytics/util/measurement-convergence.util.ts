/**
 * The arithmetic behind EFF-80 · "Do the rulers agree?" (AAQ-222, Helping
 * skills): can the cheap per-session signals stand in for the foundational
 * helping-skills (FHS) judge?
 *
 * Over SINGLE-SCENARIO scored cuts (every session in the cut ran the same
 * scenario), each cut gets one value per ruler and every pair of rulers gets a
 * Spearman rank correlation with its n. Pure functions over rows the
 * repositories return, so the ranking, the z-scoring, the single-scenario
 * filter and the floors are unit-tested without a database.
 *
 * Every ruler is oriented "higher = better", so agreement reads as a
 * POSITIVE r. Agreement is not validity: two LLM-scored signals can agree and
 * both be wrong — that is what human ratings (EFF-81, AAQ-223) are for.
 */

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pairs a cell needs before its r is shown; echoed in the response. */
export const MIN_PAIRS_FOR_CONVERGENCE = 50;

/** Countable scored sessions a scenario version needs before its scores are z-scored. */
export const MIN_SESSIONS_FOR_SCORE_Z = 5;

export type ConvergenceRulerKey = 'R1' | 'R2' | 'R3' | 'R4' | 'R6';

export interface ConvergenceRulerDef {
  key: ConvergenceRulerKey;
  label: string;
  description: string;
}

/** The rulers compared, in matrix order — declared once and echoed. */
export const CONVERGENCE_RULERS: readonly ConvergenceRulerDef[] = [
  {
    key: 'R1',
    label: 'Helping-skills composite',
    description:
      "The cut's foundational helping-skills composite (1–4), scored by the FHS judge on the learner's own speech; rubric-pinned. The reference ruler.",
  },
  {
    key: 'R2',
    label: 'Session score (z within version)',
    description: `Mean over the cut's sessions of the session score z-scored within its scenario version (against every countable scored session of that version; versions with fewer than ${MIN_SESSIONS_FOR_SCORE_Z} skipped; the unresolved 0 with no detected event excluded). Raw scores are not comparable across scenarios.`,
  },
  {
    key: 'R3',
    label: 'Behaviour-instruction balance',
    description:
      "(should-do hits − should-not-do hits) ÷ all hits, pooled over the cut's sessions, from the scenario's live behaviour-instruction detection; null when nothing was detected. −1..1.",
  },
  {
    key: 'R4',
    label: 'Skill coverage',
    description:
      "Mean over the cut's sessions of each session's mean `skillCoverage` percentage (0–100) from the post-session feedback; both label generations accepted, unversioned LLM output.",
  },
  {
    key: 'R6',
    label: 'Learner rating',
    description:
      "Mean 1–5 rating the learner gave the cut's sessions (self-report, sparse; sessions without a rating skipped).",
  },
];

/* -------------------------------------------------------------------------- */
/* Rank correlation                                                           */
/* -------------------------------------------------------------------------- */

/** 1-based ranks with ties given the average of the ranks they span. */
export function averageRanks(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rho: the Pearson correlation of the average ranks (correct with
 * ties, unlike the 1 − 6Σd²/n(n²−1) shortcut). Null below 2 pairs or when
 * either side is constant — no ordering, nothing to agree with.
 */
export function spearman(
  xs: readonly number[],
  ys: readonly number[],
): number | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const mx = mean(rx) as number;
  const my = mean(ry) as number;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/* -------------------------------------------------------------------------- */
/* Per-session signals                                                        */
/* -------------------------------------------------------------------------- */

/** What the session read returns for one session id. */
export interface ConvergenceSessionSignals {
  scenarioId: number | null;
  versionId: string | null;
  score: number | null;
  /**
   * The score is a countable, resolved session score: ENDED + COMPLETED,
   * countable room, non-null, and not the unresolved 0 (no detected event).
   */
  scoreEligible: boolean;
  doHits: number;
  dontHits: number;
  /** Raw `summary->'feedback'->'skillCoverage'` (jsonb), parsed here. */
  skillCoverage: unknown;
  /** Mean learner rating of the session; null when unrated. */
  rating: number | null;
}

/** Distribution of countable scored sessions of one scenario version. */
export interface VersionScoreStats {
  sessions: number;
  mean: number;
  sd: number | null;
}

/** Key a scenario version; NULL-version sessions (pre-versioning) are their own group. */
export const versionKey = (
  scenarioId: number | null,
  versionId: string | null,
): string => `${scenarioId ?? 'none'}:${versionId ?? 'none'}`;

/**
 * A session score as a z within its scenario version. Null when the score is
 * not eligible, the version has fewer than `minSessions` sessions, or its
 * scores do not vary (sd 0 or unknown).
 */
export function scoreZ(
  session: ConvergenceSessionSignals,
  stats: VersionScoreStats | undefined,
  minSessions: number = MIN_SESSIONS_FOR_SCORE_Z,
): number | null {
  if (!session.scoreEligible || session.score === null || !stats) return null;
  if (stats.sessions < minSessions || !stats.sd || stats.sd <= 0) return null;
  return (session.score - stats.mean) / stats.sd;
}

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Mean percentage across whatever `skillCoverage` categories a session's
 * feedback carries. Two label generations exist, so the category names are
 * deliberately ignored; anything that is not a `{category, percentage}` pair
 * is dropped rather than guessed at. Null when nothing usable is present.
 */
export function meanSkillCoverage(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const pcts = value
    .map((e) => {
      if (typeof e !== 'object' || e === null) return null;
      const entry = e as Record<string, unknown>;
      if (typeof entry.category !== 'string') return null;
      return toNumber(entry.percentage);
    })
    .filter((p): p is number => p !== null);
  return mean(pcts);
}

/* -------------------------------------------------------------------------- */
/* Per-cut ruler values                                                       */
/* -------------------------------------------------------------------------- */

export interface ConvergenceCut {
  userId: number;
  /** R1: the cut composite. */
  score: number;
  sessionIds: readonly string[];
}

export type CutRulerValues = Record<ConvergenceRulerKey, number | null>;

/**
 * The scenario a cut ran, when it ran exactly one: every session known and
 * all on the same scenario. Null otherwise (mixed, or a session we cannot see).
 */
export function singleScenarioOf(
  cut: ConvergenceCut,
  sessions: ReadonlyMap<string, ConvergenceSessionSignals>,
): number | null {
  if (cut.sessionIds.length === 0) return null;
  let scenario: number | null = null;
  for (const id of cut.sessionIds) {
    const s = sessions.get(id);
    if (!s || s.scenarioId === null) return null;
    if (scenario === null) scenario = s.scenarioId;
    else if (s.scenarioId !== scenario) return null;
  }
  return scenario;
}

/** One value per ruler for one cut (null where the ruler has nothing to say). */
export function cutRulerValues(
  cut: ConvergenceCut,
  sessions: ReadonlyMap<string, ConvergenceSessionSignals>,
  stats: ReadonlyMap<string, VersionScoreStats>,
  minSessions: number = MIN_SESSIONS_FOR_SCORE_Z,
): CutRulerValues {
  const own = [...new Set(cut.sessionIds)]
    .map((id) => sessions.get(id))
    .filter((s): s is ConvergenceSessionSignals => !!s);

  const zs = own
    .map((s) =>
      scoreZ(s, stats.get(versionKey(s.scenarioId, s.versionId)), minSessions),
    )
    .filter((z): z is number => z !== null);

  const doHits = own.reduce((a, s) => a + s.doHits, 0);
  const dontHits = own.reduce((a, s) => a + s.dontHits, 0);
  const hits = doHits + dontHits;

  const coverage = own
    .map((s) => meanSkillCoverage(s.skillCoverage))
    .filter((v): v is number => v !== null);
  const ratings = own
    .map((s) => s.rating)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  return {
    R1: Number.isFinite(cut.score) ? cut.score : null,
    R2: mean(zs),
    R3: hits > 0 ? (doHits - dontHits) / hits : null,
    R4: mean(coverage),
    R6: mean(ratings),
  };
}

/* -------------------------------------------------------------------------- */
/* The matrix                                                                 */
/* -------------------------------------------------------------------------- */

export interface ConvergencePair {
  a: ConvergenceRulerKey;
  b: ConvergenceRulerKey;
  /** Single-scenario cuts with a value on both rulers. */
  n: number;
  /** Distinct learners behind those cuts. */
  learners: number;
  /** Spearman r, 3 dp; null below `minPairs` or when either side is constant. */
  r: number | null;
}

export interface ConvergenceComputation {
  cuts: {
    total: number;
    singleScenario: number;
    singleScenarioPct: number | null;
  };
  rulers: (ConvergenceRulerDef & { cuts: number })[];
  pairs: ConvergencePair[];
  strongest: ConvergencePair | null;
  weakest: ConvergencePair | null;
}

/**
 * Every ruler pair over the single-scenario cuts. Cut-level, not
 * learner-level: one learner contributes several cuts, so `n` overstates the
 * independent evidence (`learners` says by how much) — which is why no
 * interval or p-value is offered. `strongest`/`weakest` are the highest and
 * lowest non-null r (ties: more pairs first, then matrix order); `weakest` is
 * null until two cells are shown.
 */
export function buildConvergence(input: {
  cuts: readonly ConvergenceCut[];
  sessions: ReadonlyMap<string, ConvergenceSessionSignals>;
  stats: ReadonlyMap<string, VersionScoreStats>;
  minPairs?: number;
  minSessions?: number;
}): ConvergenceComputation {
  const minPairs = input.minPairs ?? MIN_PAIRS_FOR_CONVERGENCE;
  const single = input.cuts.filter(
    (c) => singleScenarioOf(c, input.sessions) !== null,
  );
  const values = single.map((c) => ({
    userId: c.userId,
    v: cutRulerValues(c, input.sessions, input.stats, input.minSessions),
  }));

  const rulers = CONVERGENCE_RULERS.map((def) => ({
    ...def,
    cuts: values.filter((x) => x.v[def.key] !== null).length,
  }));

  const pairs: ConvergencePair[] = [];
  for (let i = 0; i < CONVERGENCE_RULERS.length; i += 1) {
    for (let j = i + 1; j < CONVERGENCE_RULERS.length; j += 1) {
      const a = CONVERGENCE_RULERS[i].key;
      const b = CONVERGENCE_RULERS[j].key;
      const both = values.filter((x) => x.v[a] !== null && x.v[b] !== null);
      const r =
        both.length >= minPairs
          ? spearman(
              both.map((x) => x.v[a] as number),
              both.map((x) => x.v[b] as number),
            )
          : null;
      pairs.push({
        a,
        b,
        n: both.length,
        learners: new Set(both.map((x) => x.userId)).size,
        r: r === null ? null : round3(r),
      });
    }
  }

  const shown = pairs.filter((p) => p.r !== null);
  const pick = (dir: 1 | -1) =>
    [...shown].sort(
      (p, q) => dir * ((q.r as number) - (p.r as number)) || q.n - p.n,
    )[0] ?? null;

  return {
    cuts: {
      total: input.cuts.length,
      singleScenario: single.length,
      singleScenarioPct: input.cuts.length
        ? round1((single.length / input.cuts.length) * 100)
        : null,
    },
    rulers,
    pairs,
    strongest: pick(1),
    weakest: shown.length >= 2 ? pick(-1) : null,
  };
}
