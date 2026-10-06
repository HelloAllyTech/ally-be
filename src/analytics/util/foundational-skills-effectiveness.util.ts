import {
  FHS_RUBRIC,
  FhsTier,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { FHS_TIERS } from './foundational-skills-progress.util';
import { pairedChange } from './paired-stats.util';

/**
 * The arithmetic behind three Highlights → Helping skills cards that ask what
 * practice does over TIME rather than start vs now:
 *
 *  - **Time to competence** (AAQ-205): how many 5,000-character slices of
 *    practice until a learner has shown every basic behaviour of a tier, as a
 *    Kaplan–Meier curve so a learner who simply stopped is not counted as
 *    "never got there".
 *  - **Retention after a break** (AAQ-206): the change from one scored slice
 *    to the next, grouped by how long the learner was away in between, with
 *    the no-break band as the reference.
 *  - **Difficulty mix by practice ordinal** (AAQ-207): the share of a
 *    learner's Nth session spent on easy / medium / hard scenarios.
 *
 * Pure functions over already-read rows, so floors, censoring, the gap rule
 * and the per-learner collapse are tested without a database. Statistics come
 * from `paired-stats.util` — nothing here re-implements an interval.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** Median of a non-empty list (mean of the two middles when even). */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const levelOf = (
  levels: Record<string, number> | null | undefined,
  skill: string,
): number | null => {
  if (!levels || !Object.prototype.hasOwnProperty.call(levels, skill)) {
    return null;
  }
  const v = Number(levels[skill]);
  return Number.isFinite(v) ? v : null;
};

/* ========================================================================== */
/* Time to competence (EFF-15, AAQ-205)                                       */
/* ========================================================================== */

/** Level 3 = every basic behaviour of the skill, and no unhelpful one. */
export const FHS_COMPETENCE_LEVEL = 3;

/**
 * Skills of each tier a learner must have reached level 3 on (each at least
 * once) for the tier to count as reached: every counted skill but one. One is
 * let off because some skills are almost never assessable in a slice — `harm`
 * and `confidentiality` need the client to raise them — so "all of them"
 * would read as "nobody, ever" for reasons the learner cannot control.
 *
 * Counted over the skills the rubric lets move: every tier skill but one,
 * after {@link TIER_COMPETENCE_EXCLUDED_SKILLS}. Over ALL rubric skills the
 * rule was unreachable on production (2026-10-05, 74 learners): Engage 5 of 6
 * needed two of `rapport` (capped at 2), `confidentiality` and `harm` (each
 * assessable in ~11–13% of slices), and nobody had reached it; Understand had
 * the same shape with `family` capped (6 of 74). Counting only movable skills,
 * Engage 2 of 3 was reached by 38 of 74 and Understand 3 of 4 by 23 of 74 —
 * a curve that says something about learners rather than about the rubric.
 */
export const TIER_COMPETENCE_SKILLS: Readonly<Record<FhsTier, number>> = {
  engage: 2,
  understand: 3,
  support: 2,
};

/**
 * Skills left out of every tier's competence count, with why — the same four
 * the Helping skills tab labels "not measurable": `rapport` and `family` are
 * effectively capped at level 2 (every basic behaviour in one 5,000-character
 * slice is out of reach — a rubric ceiling that needs an FHS_RUBRIC_VERSION
 * bump to lift), and `confidentiality` and `harm` are assessable only when the
 * client raises them. Fixed here rather than recomputed from the data so the
 * curve's definition cannot shift silently as volume grows; served in the
 * response so the card can name them.
 */
export const TIER_COMPETENCE_EXCLUDED_SKILLS: readonly string[] = [
  'rapport',
  'confidentiality',
  'harm',
  'family',
];

export const TIER_COMPETENCE_EXCLUSION_REASONS: Readonly<
  Record<string, 'capped' | 'rare'>
> = {
  rapport: 'capped',
  family: 'capped',
  confidentiality: 'rare',
  harm: 'rare',
};

/** Rubric skill keys of one tier, in rubric order. */
export const tierSkillKeys = (tier: FhsTier): string[] =>
  FHS_RUBRIC.filter((s) => s.tier === tier).map((s) => s.key);

/** The tier's skills that count toward competence, in rubric order. */
export const tierCompetenceSkillKeys = (tier: FhsTier): string[] =>
  tierSkillKeys(tier).filter(
    (k) => !TIER_COMPETENCE_EXCLUDED_SKILLS.includes(k),
  );

export interface CompetenceCut {
  cut: number;
  /** Only skills the slice gave an opportunity for. */
  levels: Record<string, number>;
}

export interface CompetenceLearner {
  userId: number;
  /** One entry per scored cut, any order. */
  cuts: CompetenceCut[];
}

export interface TierReach {
  /** Per tier skill: the first cut it scored ≥ 3; null when it never has. */
  firstReach: Record<string, number | null>;
  /** Per tier skill: true when it was assessable in at least one cut. */
  assessed: Record<string, boolean>;
  /**
   * The first cut BY WHICH `required` of the tier's skills have each reached
   * level 3 at least once (not necessarily in the same cut); null when not
   * yet. A one-time crossing: later slices below 3 do not undo it.
   */
  competenceCut: number | null;
}

/** When (if ever) one learner reached a tier. */
export function tierReach(
  cuts: readonly CompetenceCut[],
  tier: FhsTier,
  required: number = TIER_COMPETENCE_SKILLS[tier],
  level: number = FHS_COMPETENCE_LEVEL,
): TierReach {
  const ordered = [...cuts].sort((a, b) => a.cut - b.cut);
  const firstReach: Record<string, number | null> = {};
  const assessed: Record<string, boolean> = {};
  for (const skill of tierCompetenceSkillKeys(tier)) {
    firstReach[skill] = null;
    assessed[skill] = false;
    for (const c of ordered) {
      const v = levelOf(c.levels, skill);
      if (v === null) continue;
      assessed[skill] = true;
      if (v >= level) {
        firstReach[skill] = c.cut;
        break;
      }
    }
  }
  const firsts = Object.values(firstReach)
    .filter((k): k is number => k !== null)
    .sort((a, b) => a - b);
  const competenceCut =
    required >= 1 && firsts.length >= required ? firsts[required - 1] : null;
  return { firstReach, assessed, competenceCut };
}

export interface SurvivalSubject {
  /** The last cut this learner was observed at (their highest scored cut). */
  lastCut: number;
  /** The cut the event happened at; null when it has not (yet). */
  eventCut: number | null;
}

export interface SurvivalPoint {
  cut: number;
  /** Observed through this cut and not reached before it. */
  atRisk: number;
  /** Of those, reached at this cut. */
  reachedAtCut: number;
  /** Of those, not reached and last observed at this cut (they leave the curve). */
  censoredAtCut: number;
  /** Kaplan–Meier cumulative share reached by this cut, 0–1, unrounded. */
  cumulative: number;
}

/**
 * Kaplan–Meier "share reached by cut k": 1 − Π_{j≤k} (1 − d_j / n_j), where
 * n_j is everyone still observed at j who has not reached it before j and d_j
 * those who reach it at j. A learner who stops practising before reaching it
 * leaves the at-risk count (censored) instead of counting as "never" — the
 * curve is "of those still practising, how many got there", not a headcount.
 */
export function kaplanMeier(
  subjects: readonly SurvivalSubject[],
  maxCut?: number,
): SurvivalPoint[] {
  const norm = subjects.map((s) => ({
    lastCut: Math.max(s.lastCut, s.eventCut ?? 0),
    eventCut: s.eventCut,
  }));
  const K = maxCut ?? norm.reduce((m, s) => Math.max(m, s.lastCut), 0);
  let survival = 1;
  const points: SurvivalPoint[] = [];
  for (let k = 1; k <= K; k += 1) {
    let atRisk = 0;
    let reached = 0;
    let censored = 0;
    for (const s of norm) {
      if (s.lastCut < k) continue;
      if (s.eventCut !== null && s.eventCut < k) continue;
      atRisk += 1;
      if (s.eventCut === k) reached += 1;
      else if (s.lastCut === k) censored += 1;
    }
    if (atRisk > 0) survival *= 1 - reached / atRisk;
    points.push({
      cut: k,
      atRisk,
      reachedAtCut: reached,
      censoredAtCut: censored,
      cumulative: 1 - survival,
    });
  }
  return points;
}

/** Key for the practice-minutes lookup: one learner's competence cut. */
export const reachKey = (userId: number, cut: number): string =>
  `${userId}:${cut}`;

/** Learners who enter the curve: their FIRST slice is scored (in scope). */
const enters = (l: CompetenceLearner): boolean =>
  l.cuts.some((c) => c.cut === 1);

/**
 * Every (learner, cut) at which an entered learner reached some tier — what
 * the practice-minutes read needs. Deduplicated across tiers.
 */
export function competenceReaches(
  learners: readonly CompetenceLearner[],
): { userId: number; cut: number }[] {
  const seen = new Map<string, { userId: number; cut: number }>();
  for (const l of learners) {
    if (!enters(l)) continue;
    for (const tier of FHS_TIERS) {
      const { competenceCut } = tierReach(l.cuts, tier);
      if (competenceCut === null) continue;
      seen.set(reachKey(l.userId, competenceCut), {
        userId: l.userId,
        cut: competenceCut,
      });
    }
  }
  return [...seen.values()];
}

export interface TimeToCompetencePoint {
  cut: number;
  atRisk: number;
  reachedAtCut: number;
  censoredAtCut: number;
  /** Percent (1 dp); null when `atRisk` is below the sample floor. */
  reachedShare: number | null;
}

export interface TimeToCompetenceMissingSkill {
  skill: string;
  name: string;
  /** Not-yet-reached learners who have never scored 3+ on this skill. */
  missingLearners: number;
  /** …of whom the skill was never even assessable (no opportunity). */
  neverAssessed: number;
  /** …of whom it was assessable but never reached 3. */
  assessedBelow: number;
  /** `missingLearners` as a percent of the not-yet-reached; null below the cohort floor. */
  sharePct: number | null;
}

export interface TimeToCompetenceTier {
  tier: FhsTier;
  skills: string[];
  skillsRequired: number;
  points: TimeToCompetencePoint[];
  reachedLearners: number;
  notReachedLearners: number;
  medianCuts: number | null;
  notReachedByHalf: boolean;
  lastShownCut: number | null;
  medianMinutes: number | null;
  minutesLearners: number;
  missing: {
    learners: number;
    mostOftenMissing: string | null;
    skills: TimeToCompetenceMissingSkill[];
  };
}

export interface TimeToCompetenceComputation {
  learners: number;
  learnersWithoutFirstCut: number;
  maxCut: number;
  tiers: TimeToCompetenceTier[];
}

/**
 * The whole time-to-competence card.
 *
 * - Learners enter at cut 1: someone whose first slice is not scored in scope
 *   (it failed, or it was practised in another org) is counted in
 *   `learnersWithoutFirstCut` and left out, since what they did before is
 *   unseen.
 * - Per tier, the axis ends at the last cut at least `minCohort` learners are
 *   at risk for; a point's share is withheld below `sampleFloor` at risk.
 * - The median is the first SHOWN cut whose share reaches 50%. If the shown
 *   curve never gets there, `medianCuts` is null and `notReachedByHalf` true;
 *   with no shown point at all both stay quiet (null / false) — that is "too
 *   few learners", not "not reached".
 * - `minutes` maps {@link reachKey} → practice minutes up to that cut; the
 *   median is over learners who reached the tier, withheld below `sampleFloor`.
 */
export function computeTimeToCompetence(
  learners: readonly CompetenceLearner[],
  opts: {
    sampleFloor: number;
    minCohort: number;
    minutes?: ReadonlyMap<string, number | null>;
  },
): TimeToCompetenceComputation {
  const entered = learners.filter(enters);
  const names = new Map(FHS_RUBRIC.map((s) => [s.key, s.name]));
  const order = new Map(FHS_RUBRIC.map((s, i) => [s.key, i]));

  const tiers = FHS_TIERS.map((tier): TimeToCompetenceTier => {
    const skills = tierCompetenceSkillKeys(tier);
    const required = TIER_COMPETENCE_SKILLS[tier];
    const reaches = entered.map((l) => ({
      learner: l,
      reach: tierReach(l.cuts, tier, required),
      lastCut: l.cuts.reduce((m, c) => Math.max(m, c.cut), 0),
    }));

    const km = kaplanMeier(
      reaches.map((r) => ({
        lastCut: r.lastCut,
        eventCut: r.reach.competenceCut,
      })),
    );
    let last = 0;
    km.forEach((p) => {
      if (p.atRisk >= opts.minCohort) last = p.cut;
    });
    const shown = km.slice(0, last);
    const points = shown.map(
      (p): TimeToCompetencePoint => ({
        cut: p.cut,
        atRisk: p.atRisk,
        reachedAtCut: p.reachedAtCut,
        censoredAtCut: p.censoredAtCut,
        reachedShare:
          p.atRisk >= opts.sampleFloor ? round1(p.cumulative * 100) : null,
      }),
    );
    const visible = shown.filter((p) => p.atRisk >= opts.sampleFloor);
    const crossing = visible.find((p) => p.cumulative >= 0.5 - 1e-12);
    const lastShownCut = visible.length
      ? visible[visible.length - 1].cut
      : null;

    const reachers = reaches.filter((r) => r.reach.competenceCut !== null);
    const minutes = reachers
      .map((r) =>
        opts.minutes?.get(
          reachKey(r.learner.userId, r.reach.competenceCut as number),
        ),
      )
      .filter((m): m is number => typeof m === 'number' && Number.isFinite(m));
    const medMinutes = median(minutes);

    const notReached = reaches.filter((r) => r.reach.competenceCut === null);
    const missingSkills = skills
      .map((skill): TimeToCompetenceMissingSkill => {
        const missing = notReached.filter(
          (r) => r.reach.firstReach[skill] === null,
        );
        const neverAssessed = missing.filter(
          (r) => !r.reach.assessed[skill],
        ).length;
        return {
          skill,
          name: names.get(skill) ?? skill,
          missingLearners: missing.length,
          neverAssessed,
          assessedBelow: missing.length - neverAssessed,
          sharePct:
            notReached.length >= opts.minCohort
              ? round1((missing.length / notReached.length) * 100)
              : null,
        };
      })
      .sort(
        (a, b) =>
          b.missingLearners - a.missingLearners ||
          (order.get(a.skill) ?? 0) - (order.get(b.skill) ?? 0),
      );
    const top = missingSkills[0];

    return {
      tier,
      skills,
      skillsRequired: required,
      points,
      reachedLearners: reachers.length,
      notReachedLearners: notReached.length,
      medianCuts: crossing ? crossing.cut : null,
      notReachedByHalf: visible.length > 0 && !crossing,
      lastShownCut,
      medianMinutes:
        medMinutes !== null && minutes.length >= opts.sampleFloor
          ? round1(medMinutes)
          : null,
      minutesLearners: minutes.length,
      missing: {
        learners: notReached.length,
        mostOftenMissing:
          notReached.length >= opts.minCohort && top && top.missingLearners > 0
            ? top.skill
            : null,
        skills: missingSkills,
      },
    };
  });

  return {
    learners: entered.length,
    learnersWithoutFirstCut: learners.length - entered.length,
    maxCut: tiers.reduce((m, t) => Math.max(m, t.points.length), 0),
    tiers,
  };
}

/* ========================================================================== */
/* Retention after a break (EFF-11, AAQ-206)                                  */
/* ========================================================================== */

export type RetentionBandKey = '<7' | '7-13' | '14-29' | '30+';

export interface RetentionBandDef {
  band: RetentionBandKey;
  label: string;
  /** Inclusive lower bound, days. */
  minDays: number;
  /** Exclusive upper bound, days; null for the open top band. */
  maxDays: number | null;
}

export const RETENTION_GAP_BANDS: readonly RetentionBandDef[] = [
  { band: '<7', label: 'Under 7 days', minDays: 0, maxDays: 7 },
  { band: '7-13', label: '7–13 days', minDays: 7, maxDays: 14 },
  { band: '14-29', label: '14–29 days', minDays: 14, maxDays: 30 },
  { band: '30+', label: '30+ days', minDays: 30, maxDays: null },
];

/** The "no break" comparison every other band is read against. */
export const RETENTION_REFERENCE_BAND: RetentionBandKey = '<7';
/** The band the takeaway sentence names. */
export const RETENTION_LONG_BREAK_BAND: RetentionBandKey = '30+';
/** A band's statistics need at least this many distinct learners… */
export const RETENTION_MIN_LEARNERS = 10;

/** Band for a gap in (fractional) days; negative gaps are treated as 0. */
export function gapBand(days: number): RetentionBandKey {
  const d = Math.max(0, days);
  for (const b of RETENTION_GAP_BANDS) {
    if (b.maxDays === null || d < b.maxDays) return b.band;
  }
  return RETENTION_GAP_BANDS[RETENTION_GAP_BANDS.length - 1].band;
}

export interface RetentionCut {
  cut: number;
  /** Composite, 1–4. */
  score: number;
  unhelpful: boolean | null;
  /** Every session the cut touches. */
  sessionIds: string[];
}

export interface RetentionLearner {
  userId: number;
  cuts: RetentionCut[];
}

export interface SessionTimes {
  startedAt: Date | null;
  endedAt: Date | null;
}

export type CutGap =
  | { kind: 'gap'; days: number; overlapped: boolean }
  | { kind: 'sameSession' }
  | { kind: 'missingTimes' };

/**
 * Time away between two consecutive cuts: the start of the first session in
 * `after` that is NOT already in `before`, minus the end of the last session
 * of `before`.
 *
 * - `sameSession`: `after` lies wholly inside sessions `before` already
 *   touched (one long roleplay spanning two slices) — there was no gap to
 *   measure, so the pair is counted, not plotted.
 * - `missingTimes`: a session either side has no timestamp (or no row).
 * - A negative difference (a session in `after` started before `before`'s last
 *   one ended — two roleplays open at once) is no break: clamped to 0 and
 *   flagged `overlapped`.
 */
export function cutGap(
  before: RetentionCut,
  after: RetentionCut,
  times: ReadonlyMap<string, SessionTimes>,
): CutGap {
  const beforeIds = new Set(before.sessionIds);
  const fresh = after.sessionIds.filter((id) => !beforeIds.has(id));
  if (fresh.length === 0) return { kind: 'sameSession' };
  if (before.sessionIds.length === 0) return { kind: 'missingTimes' };

  let end = -Infinity;
  for (const id of before.sessionIds) {
    const t = times.get(id)?.endedAt;
    if (!t) return { kind: 'missingTimes' };
    end = Math.max(end, t.getTime());
  }
  let start = Infinity;
  for (const id of fresh) {
    const t = times.get(id)?.startedAt;
    if (!t) return { kind: 'missingTimes' };
    start = Math.min(start, t.getTime());
  }
  const raw = (start - end) / DAY_MS;
  return { kind: 'gap', days: Math.max(0, raw), overlapped: raw < 0 };
}

export interface RetentionChange {
  /** Consecutive-cut pairs in the band. Always travels. */
  pairs: number;
  /** Distinct learners behind them. Always travels. */
  learners: number;
  /** True when pairs ≥ minPairs AND learners ≥ minLearners. */
  measurable: boolean;
  change: number | null;
  ci: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  detectable: boolean;
}

export interface RetentionBand extends RetentionBandDef {
  reference: boolean;
  /** Median gap of the band's pairs, days (1 dp); null unless measurable. */
  medianGapDays: number | null;
  /** Composite (1–4) change cut k → k+1. */
  composite: RetentionChange;
  /** Change in "slice shows any unhelpful behaviour", percentage points. */
  unhelpful: RetentionChange;
}

export interface RetentionComputation {
  pairs: {
    /** Learner's scored cuts taken in order: every (k, next scored) pair. */
    considered: number;
    /** Skipped because the next scored cut is not k+1 (one in between failed or is pending). */
    nonAdjacent: number;
    /** k+1 lies wholly inside sessions cut k already touched. */
    sameSession: number;
    /** A session either side has no start/end time. */
    missingTimes: number;
    /** Plotted pairs whose sessions overlapped (gap clamped to 0). */
    overlapping: number;
    /** Placed in a band. */
    plotted: number;
  };
  learners: number;
  bands: RetentionBand[];
  takeaway: {
    referenceBand: RetentionBandKey;
    referenceChange: number | null;
    referenceCi: [number, number] | null;
    longBreakBand: RetentionBandKey;
    longBreakChange: number | null;
    longBreakCi: [number, number] | null;
  };
}

interface PlacedPair {
  userId: number;
  band: RetentionBandKey;
  days: number;
  change: number;
  /** Percentage points (−100 / 0 / 100), null when either side was uncoded. */
  unhelpfulChange: number | null;
}

/**
 * One value per learner (the mean of their pairs), then a paired bootstrap
 * over learners — so a learner with six short gaps does not count six times.
 */
function bandChange(
  pairs: readonly { userId: number; value: number }[],
  opts: { minPairs: number; minLearners: number },
  r: (v: number) => number,
): RetentionChange {
  const byLearner = new Map<number, number[]>();
  for (const p of pairs) {
    const list = byLearner.get(p.userId);
    if (list) list.push(p.value);
    else byLearner.set(p.userId, [p.value]);
  }
  const values = [...byLearner.values()].map(mean);
  const pc = pairedChange(values);
  const measurable =
    pairs.length >= opts.minPairs && byLearner.size >= opts.minLearners;
  return {
    pairs: pairs.length,
    learners: byLearner.size,
    measurable,
    change: measurable && pc.meanChange !== null ? r(pc.meanChange) : null,
    ci: measurable && pc.ci ? [r(pc.ci[0]), r(pc.ci[1])] : null,
    up: pc.up,
    down: pc.down,
    tied: pc.tied,
    signP: measurable && pc.signP !== null ? round3(pc.signP) : null,
    detectable: measurable && pc.detectable,
  };
}

/** The whole retention card. `learners[].cuts` in any order. */
export function computeRetention(
  learners: readonly RetentionLearner[],
  times: ReadonlyMap<string, SessionTimes>,
  opts: { minPairs: number; minLearners: number },
): RetentionComputation {
  const counts = {
    considered: 0,
    nonAdjacent: 0,
    sameSession: 0,
    missingTimes: 0,
    overlapping: 0,
    plotted: 0,
  };
  const placed: PlacedPair[] = [];

  for (const l of learners) {
    const cuts = [...l.cuts].sort((a, b) => a.cut - b.cut);
    for (let i = 0; i + 1 < cuts.length; i += 1) {
      const before = cuts[i];
      const after = cuts[i + 1];
      counts.considered += 1;
      if (after.cut !== before.cut + 1) {
        counts.nonAdjacent += 1;
        continue;
      }
      const gap = cutGap(before, after, times);
      if (gap.kind === 'sameSession') {
        counts.sameSession += 1;
        continue;
      }
      if (gap.kind === 'missingTimes') {
        counts.missingTimes += 1;
        continue;
      }
      counts.plotted += 1;
      if (gap.overlapped) counts.overlapping += 1;
      placed.push({
        userId: l.userId,
        band: gapBand(gap.days),
        days: gap.days,
        change: after.score - before.score,
        unhelpfulChange:
          before.unhelpful === null || after.unhelpful === null
            ? null
            : (Number(after.unhelpful) - Number(before.unhelpful)) * 100,
      });
    }
  }

  const bands = RETENTION_GAP_BANDS.map((def): RetentionBand => {
    const inBand = placed.filter((p) => p.band === def.band);
    const composite = bandChange(
      inBand.map((p) => ({ userId: p.userId, value: p.change })),
      opts,
      round2,
    );
    const unhelpful = bandChange(
      inBand
        .filter((p) => p.unhelpfulChange !== null)
        .map((p) => ({ userId: p.userId, value: p.unhelpfulChange as number })),
      opts,
      round1,
    );
    const med = median(inBand.map((p) => p.days));
    return {
      ...def,
      reference: def.band === RETENTION_REFERENCE_BAND,
      medianGapDays: composite.measurable && med !== null ? round1(med) : null,
      composite,
      unhelpful,
    };
  });

  const ref = bands.find((b) => b.band === RETENTION_REFERENCE_BAND);
  const long = bands.find((b) => b.band === RETENTION_LONG_BREAK_BAND);
  return {
    pairs: counts,
    learners: new Set(placed.map((p) => p.userId)).size,
    bands,
    takeaway: {
      referenceBand: RETENTION_REFERENCE_BAND,
      referenceChange: ref?.composite.change ?? null,
      referenceCi: ref?.composite.ci ?? null,
      longBreakBand: RETENTION_LONG_BREAK_BAND,
      longBreakChange: long?.composite.change ?? null,
      longBreakCi: long?.composite.ci ?? null,
    },
  };
}

/* ========================================================================== */
/* Difficulty mix by practice ordinal (EFF-12, AAQ-207)                       */
/* ========================================================================== */

/** The learner's Nth countable session, 1..this. */
export const PRACTICE_PROGRESSION_MAX_ORDINAL = 12;

export const PRACTICE_DIFFICULTY_LEVELS = [
  'EASY',
  'MEDIUM',
  'HARD',
  'untagged',
] as const;
export type PracticeDifficulty = (typeof PRACTICE_DIFFICULTY_LEVELS)[number];

export type DifficultyCounts = Record<PracticeDifficulty, number>;
export type DifficultyShares = Record<PracticeDifficulty, number | null>;

export interface PracticeOrdinalRow {
  ordinal: number;
  difficulty: string;
  /** Sessions at this ordinal and difficulty, every learner. */
  sessions: number;
  /** The same, for learners with at least `maxOrdinal` sessions in total. */
  experiencedSessions: number;
}

export interface PracticeProgressionCell {
  sessions: number;
  counts: DifficultyCounts;
  shares: DifficultyShares;
}

export interface PracticeProgressionOrdinal extends PracticeProgressionCell {
  ordinal: number;
  experienced: PracticeProgressionCell;
}

export interface PracticeProgressionComputation {
  learners: number;
  experiencedLearners: number;
  ordinals: PracticeProgressionOrdinal[];
}

const asDifficulty = (raw: string): PracticeDifficulty =>
  (PRACTICE_DIFFICULTY_LEVELS as readonly string[]).includes(raw)
    ? (raw as PracticeDifficulty)
    : 'untagged';

const emptyCounts = (): DifficultyCounts => ({
  EASY: 0,
  MEDIUM: 0,
  HARD: 0,
  untagged: 0,
});

function cell(
  counts: DifficultyCounts,
  floor: number,
): PracticeProgressionCell {
  const sessions = PRACTICE_DIFFICULTY_LEVELS.reduce(
    (n, k) => n + counts[k],
    0,
  );
  const shares = {} as DifficultyShares;
  for (const k of PRACTICE_DIFFICULTY_LEVELS) {
    shares[k] =
      sessions > 0 && sessions >= floor
        ? round1((counts[k] / sessions) * 100)
        : null;
  }
  return { sessions, counts, shares };
}

/**
 * Every ordinal 1..`maxOrdinal` (an ordinal nobody reached comes back with
 * zero counts and null shares), each with the all-comers mix and the mix for
 * the fixed panel of learners who reached `maxOrdinal` — the survivorship
 * control: if only the all-comers line drifts toward hard, it is who kept
 * practising, not people moving up.
 */
export function buildPracticeProgression(
  rows: readonly PracticeOrdinalRow[],
  opts: { maxOrdinal: number; sampleFloor: number },
): PracticeProgressionComputation {
  const all = new Map<number, DifficultyCounts>();
  const exp = new Map<number, DifficultyCounts>();
  for (let k = 1; k <= opts.maxOrdinal; k += 1) {
    all.set(k, emptyCounts());
    exp.set(k, emptyCounts());
  }
  for (const r of rows) {
    const a = all.get(r.ordinal);
    const e = exp.get(r.ordinal);
    if (!a || !e) continue;
    const d = asDifficulty(r.difficulty);
    a[d] += r.sessions;
    e[d] += r.experiencedSessions;
  }
  const ordinals = [...all.keys()].map(
    (k): PracticeProgressionOrdinal => ({
      ordinal: k,
      ...cell(all.get(k) as DifficultyCounts, opts.sampleFloor),
      experienced: cell(exp.get(k) as DifficultyCounts, opts.sampleFloor),
    }),
  );
  return {
    // Ordinal 1 holds exactly one session per learner.
    learners: ordinals[0]?.sessions ?? 0,
    experiencedLearners: ordinals[0]?.experienced.sessions ?? 0,
    ordinals,
  };
}
