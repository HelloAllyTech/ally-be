import { createHash } from 'crypto';

import {
  FHS_BEHAVIOURS_BY_CODE,
  FHS_RUBRIC,
} from '../constants/helping-skills-rubric.constants';
import {
  HUMAN_RATING_SAMPLE_PER_QUARTER,
  HUMAN_RATING_TERCILES,
} from '../constants/fhs-human-rating.constants';
import type { StoredSkillVerdict } from '../entity/foundational-skill-assessment.entity';
import {
  deriveLevel,
  storedJudgement,
  type SkillVerdict,
} from './skill-scoring.util';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar quarters
// ─────────────────────────────────────────────────────────────────────────────

export interface CalendarQuarter {
  /** `YYYYQn`, e.g. `2026Q3`. */
  key: string;
  /** First day of the quarter, `YYYY-MM-DD` (wall clock, like the column). */
  startDate: string;
  /** First day of the NEXT quarter, `YYYY-MM-DD` — the exclusive upper bound. */
  endDate: string;
}

const QUARTER_RE = /^(\d{4})Q([1-4])$/;

const isoDate = (year: number, monthIndex: number): string =>
  `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-01`;

/** `2026Q3` → its bounds; null for anything that is not a quarter key. */
export function parseQuarter(key: string): CalendarQuarter | null {
  const m = QUARTER_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3;
  const endYear = q === 4 ? year + 1 : year;
  const endMonth = q === 4 ? 0 : startMonth + 3;
  return {
    key,
    startDate: isoDate(year, startMonth),
    endDate: isoDate(endYear, endMonth),
  };
}

/** The quarter a moment falls in, read in UTC. */
export function quarterKeyOf(at: Date): string {
  return `${at.getUTCFullYear()}Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
}

/**
 * The most recent quarter that has ENDED — the default sample. A quarter still
 * in progress keeps gaining cuts, and each new cut can move a tercile boundary
 * or a stratum's share, so its sample is not final until the quarter closes.
 */
export function lastCompleteQuarterKey(now: Date): string {
  const year = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return q === 1 ? `${year - 1}Q4` : `${year}Q${q - 1}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The stratified sample
// ─────────────────────────────────────────────────────────────────────────────

/** One sampleable cut: scored under the pinned rubric, in a non-test org. */
export interface SampleCandidate {
  cutId: string;
  compositeScore: number;
  /** Majority session language of the cut (see the population SQL). */
  language: string;
}

export interface SampledCut<T extends SampleCandidate = SampleCandidate> {
  candidate: T;
  /** 1 (lowest composites) … 3 (highest), over the quarter's own cuts. */
  tercile: number;
}

export interface SampleStratum {
  tercile: number;
  language: string;
  /** Candidate cuts in the stratum. */
  population: number;
  /** How many of them the sample takes. */
  allocated: number;
}

export interface QuarterSample<T extends SampleCandidate = SampleCandidate> {
  quarter: string;
  population: number;
  target: number;
  strata: SampleStratum[];
  /** In stratum order (tercile, then language), each stratum in hash order. */
  items: SampledCut<T>[];
}

/**
 * The seeded order inside a stratum: SHA-256 of `<quarter>:<cutId>`, hex. The
 * quarter is the seed, so the order is fixed for a quarter and independent of
 * row order, insertion time or which rater asks. Not for secrecy — for a sample
 * nobody can steer by choosing what to open.
 */
export function sampleHash(quarter: string, cutId: string): string {
  return createHash('sha256').update(`${quarter}:${cutId}`).digest('hex');
}

const byHash = (quarter: string) => {
  const memo = new Map<string, string>();
  const hashOf = (cutId: string): string => {
    let h = memo.get(cutId);
    if (h === undefined) {
      h = sampleHash(quarter, cutId);
      memo.set(cutId, h);
    }
    return h;
  };
  return (a: { cutId: string }, b: { cutId: string }): number => {
    const ha = hashOf(a.cutId);
    const hb = hashOf(b.cutId);
    if (ha !== hb) return ha < hb ? -1 : 1;
    return a.cutId < b.cutId ? -1 : a.cutId > b.cutId ? 1 : 0;
  };
};

/**
 * Composite terciles over the quarter's own cuts, by RANK: cuts sorted by
 * composite (ties broken by the seeded hash) and split into three equal-count
 * groups. Composites are means of a handful of 1–4 levels, so they tie often;
 * value cut-points would make the bands lopsided whenever a tie straddled one.
 * Two equal composites can therefore land in neighbouring terciles — the bands
 * exist to spread the sample over the score range, not to classify a cut.
 */
export function assignTerciles<T extends SampleCandidate>(
  candidates: readonly T[],
  quarter: string,
): Map<string, number> {
  const tieBreak = byHash(quarter);
  const sorted = [...candidates].sort(
    (a, b) => a.compositeScore - b.compositeScore || tieBreak(a, b),
  );
  const n = sorted.length;
  return new Map(
    sorted.map((c, i) => [
      c.cutId,
      Math.floor((HUMAN_RATING_TERCILES * i) / n) + 1,
    ]),
  );
}

/**
 * Proportional allocation of `target` draws across strata of the given sizes,
 * with at least one draw from every non-empty stratum when there are enough
 * draws to go round, and never more draws than a stratum holds.
 *
 * Every non-empty stratum gets one; each remaining draw goes to the stratum
 * furthest below its proportional share (`target × size ÷ total`), ties to the
 * earlier stratum. So the result is the proportional split rounded the way
 * that keeps every stratum closest to its share, and it is deterministic.
 * When the strata hold no more than `target` in total, all of them are taken.
 * With more non-empty strata than draws, the largest strata get one each.
 */
export function allocateProportional(
  sizes: readonly number[],
  target: number,
): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= target) return [...sizes];
  const alloc = sizes.map(() => 0);
  const nonEmpty = sizes
    .map((size, i) => ({ size, i }))
    .filter((s) => s.size > 0);
  if (nonEmpty.length >= target) {
    [...nonEmpty]
      .sort((a, b) => b.size - a.size || a.i - b.i)
      .slice(0, target)
      .forEach((s) => (alloc[s.i] = 1));
    return alloc;
  }
  nonEmpty.forEach((s) => (alloc[s.i] = 1));
  let remaining = target - nonEmpty.length;
  while (remaining > 0) {
    let best = -1;
    let bestDeficit = -Infinity;
    sizes.forEach((size, i) => {
      if (alloc[i] >= size) return;
      const deficit = (target * size) / total - alloc[i];
      if (deficit > bestDeficit) {
        best = i;
        bestDeficit = deficit;
      }
    });
    if (best < 0) break;
    alloc[best] += 1;
    remaining -= 1;
  }
  return alloc;
}

/**
 * The quarter's human-rating sample: composite tercile × language strata,
 * proportional allocation, and the first cuts of each stratum in seeded-hash
 * order. Same candidates and quarter → same sample, whatever order they arrive
 * in. A cut sealed or scored late, a test-org flag or a rubric bump changes the
 * candidates, and can therefore change the sample; ratings are keyed by cut,
 * so a rating already made still counts wherever the sample moves.
 */
export function selectQuarterSample<T extends SampleCandidate>(
  candidates: readonly T[],
  quarter: string,
  target: number = HUMAN_RATING_SAMPLE_PER_QUARTER,
): QuarterSample<T> {
  const terciles = assignTerciles(candidates, quarter);
  const groups = new Map<
    string,
    { tercile: number; language: string; members: T[] }
  >();
  for (const c of candidates) {
    const tercile = terciles.get(c.cutId) ?? 1;
    const key = `${tercile}\u0000${c.language}`;
    const g = groups.get(key) ?? { tercile, language: c.language, members: [] };
    g.members.push(c);
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      a.tercile - b.tercile ||
      (a.language < b.language ? -1 : a.language > b.language ? 1 : 0),
  );
  const alloc = allocateProportional(
    ordered.map((g) => g.members.length),
    target,
  );
  const order = byHash(quarter);
  const items: SampledCut<T>[] = [];
  const strata = ordered.map((g, i) => {
    [...g.members]
      .sort(order)
      .slice(0, alloc[i])
      .forEach((candidate) => items.push({ candidate, tercile: g.tercile }));
    return {
      tercile: g.tercile,
      language: g.language,
      population: g.members.length,
      allocated: alloc[i],
    };
  });
  return {
    quarter,
    population: candidates.length,
    target,
    strata,
    items,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A rater's ticks → stored verdicts
// ─────────────────────────────────────────────────────────────────────────────

/** One skill as a rater submits it: what they saw, never a level. */
export interface RaterSkillTicks {
  skill: string;
  opportunity: boolean;
  observed?: readonly string[];
  notApplicable?: readonly string[];
}

export interface ValidatedHumanRating {
  /** Every rubric skill, in rubric order, with its level derived in code. */
  verdicts: StoredSkillVerdict[];
  /** Any assessed skill scored 1 — the judge's `hasUnhelpfulBehaviour` rule. */
  anyUnhelpful: boolean;
}

/**
 * Check a rater's ticks against `FHS_RUBRIC` and derive every level with the
 * judge's own `deriveLevel`, so a human level and a judge level mean exactly
 * the same thing. Returns the problems instead when there are any.
 *
 * Stricter than the judge's validation on purpose. The judge's bad ticks are
 * dropped and counted (its output cannot be sent back); a rater's are
 * REJECTED, because a person can fix them and a silently dropped tick would
 * change the level they meant to give. Rules, matching the judge's:
 *  - every rubric skill exactly once (an omitted skill would read as "no
 *    opportunity" — the reason the judge's omission is a failed attempt);
 *  - no opportunity → no ticks;
 *  - an observed code must belong to that skill;
 *  - a not-applicable code must be a CONDITIONAL BASIC of that skill and not
 *    also observed (only those may be waived — see `FhsBehaviour.conditional`).
 * Duplicate codes are collapsed. `anyUnhelpful`, when the rater sends it, must
 * match what their ticks say: the flag is defined by the ticks, as the judge's
 * is, so a mismatch is a mis-entry rather than a second opinion.
 */
export function validateHumanTicks(
  ticks: readonly RaterSkillTicks[],
  claimedAnyUnhelpful?: boolean,
):
  | { ok: true; rating: ValidatedHumanRating }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const rubricKeys = new Set(FHS_RUBRIC.map((s) => s.key));
  const bySkill = new Map<string, RaterSkillTicks>();
  for (const t of ticks) {
    if (!rubricKeys.has(t.skill)) {
      errors.push(`Unknown skill "${t.skill}"`);
    } else if (bySkill.has(t.skill)) {
      errors.push(`Skill "${t.skill}" appears more than once`);
    } else {
      bySkill.set(t.skill, t);
    }
  }

  const verdicts: SkillVerdict[] = [];
  for (const skill of FHS_RUBRIC) {
    const t = bySkill.get(skill.key);
    if (!t) {
      errors.push(
        `Skill "${skill.key}" is missing; send every skill, with opportunity false where it never arose`,
      );
      continue;
    }
    const observed = [...new Set(t.observed ?? [])];
    const notApplicable = [...new Set(t.notApplicable ?? [])];
    if (!t.opportunity) {
      if (observed.length > 0 || notApplicable.length > 0) {
        errors.push(
          `Skill "${skill.key}" has no opportunity but has behaviours ticked`,
        );
      }
      verdicts.push({
        skill: skill.key,
        opportunity: false,
        observed: [],
        notApplicable: [],
        level: null,
      });
      continue;
    }
    for (const code of observed) {
      const b = FHS_BEHAVIOURS_BY_CODE.get(code);
      if (!b || b.skill !== skill.key) {
        errors.push(`"${code}" is not a behaviour of skill "${skill.key}"`);
      }
    }
    for (const code of notApplicable) {
      const b = FHS_BEHAVIOURS_BY_CODE.get(code);
      if (
        !b ||
        b.skill !== skill.key ||
        b.kind !== 'basic' ||
        b.conditional !== true
      ) {
        errors.push(
          `"${code}" cannot be marked not applicable for "${skill.key}": only a conditional basic of that skill can`,
        );
      } else if (observed.includes(code)) {
        errors.push(`"${code}" is marked both observed and not applicable`);
      }
    }
    const observedSet = new Set(observed);
    const naSet = new Set(notApplicable);
    verdicts.push({
      skill: skill.key,
      opportunity: true,
      observed: observed.sort(),
      notApplicable: notApplicable.sort(),
      level: deriveLevel(skill, observedSet, naSet),
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const anyUnhelpful = verdicts.some((v) => v.level === 1);
  if (
    claimedAnyUnhelpful !== undefined &&
    claimedAnyUnhelpful !== anyUnhelpful
  ) {
    return {
      ok: false,
      errors: [
        anyUnhelpful
          ? 'anyUnhelpful is false, but an unhelpful behaviour is ticked'
          : 'anyUnhelpful is true, but no unhelpful behaviour is ticked; tick the behaviour you saw',
      ],
    };
  }
  return {
    ok: true,
    rating: { verdicts: storedJudgement(verdicts).verdicts, anyUnhelpful },
  };
}
