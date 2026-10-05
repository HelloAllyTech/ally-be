import { FhsTier } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { SelfEfficacyInstrument } from 'src/foundational-skills/constants/self-efficacy-instrument.constants';

import {
  FlooredPairedComparison,
  bootstrapMeanCi,
  flooredPairedComparison,
} from './paired-stats.util';

/**
 * Learner self-efficacy against the judge (EFF-71 / AAQ-230 and EFF-72 /
 * AAQ-231). Pure: the service hands in every answer and every scored cut, and
 * everything that decides a number — pairing, matching an answer to a cut,
 * classification, floors — happens here, so it is tested over fixtures.
 *
 * The self-rating is never an outcome on its own. Learners are poor and often
 * over-confident self-assessors, and the least skilled self-assess least well,
 * so each confidence number travels beside the judge's number for the same
 * people over the same span (Stacks: "Include Self-Assessment Despite Known
 * Accuracy Limitations").
 */

/** A cut is matched to an answer only when it closed within this many days of it, either side. */
export const SELF_EFFICACY_MATCH_WINDOW_DAYS = 30;

/**
 * Calibration band, in rubric levels: a rescaled self-rating more than this
 * above the judged level is over-confident, more than this below it
 * under-confident. A quarter of the 1–4 scale's range; one rubric level is a
 * whole behavioural step, so a gap inside ±0.75 is within one step.
 */
export const SELF_EFFICACY_CALIBRATION_BAND = 0.75;

/** Spearman's r is withheld below this many points. */
export const SELF_EFFICACY_MIN_SPEARMAN_POINTS = 30;

/** Scatter points returned at most (most recent first). */
export const SELF_EFFICACY_POINT_CAP = 2000;

/** The rubric skill whose over-confidence is a safety question. */
export const SELF_EFFICACY_SAFETY_SKILL = 'harm';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0–10 self-rating onto the rubric's 1–4 scale: 0 → 1, 10 → 4. */
export const rescaleSelfRating = (rating: number): number =>
  1 + (3 * rating) / 10;

export type CalibrationClass =
  | 'overConfident'
  | 'calibrated'
  | 'underConfident';

/** `gap` = rescaled self-rating − judged level. */
export function classifyCalibration(
  gap: number,
  band = SELF_EFFICACY_CALIBRATION_BAND,
): CalibrationClass {
  if (gap > band) return 'overConfident';
  if (gap < -band) return 'underConfident';
  return 'calibrated';
}

/** One stored answer, as the analytics read it. */
export interface SelfEfficacyAnswer {
  userId: number;
  trigger: string;
  answeredAt: Date;
  /** Only answered items; `{}` for a dismissal. */
  responses: Record<string, number>;
}

/** One scored cut, as `getAllLearnerCuts` returns it (only these fields are read). */
export interface SelfEfficacyCut {
  userId: number;
  closedAt: Date;
  /** Assessable skills only: an absent key is no opportunity, not a low score. */
  levels: Record<string, number>;
}

const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};
const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
const has = (o: Record<string, number>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k) && Number.isFinite(Number(o[k]));

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Answered items of an answer, restricted to the instrument's skills and its 0–10 integers. */
export function answeredItems(
  responses: Record<string, unknown> | null | undefined,
  skills: ReadonlySet<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(responses ?? {})) {
    if (!skills.has(k)) continue;
    const n = typeof v === 'number' ? v : Number.NaN;
    if (Number.isInteger(n) && n >= 0 && n <= 10) out[k] = n;
  }
  return out;
}

/** Rows grouped per learner, each group oldest first. */
export function byLearner<T extends { userId: number }>(
  rows: readonly T[],
  at: (row: T) => Date,
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const list = map.get(row.userId);
    if (list) list.push(row);
    else map.set(row.userId, [row]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => at(a).getTime() - at(b).getTime());
  }
  return map;
}

/**
 * The learner's cut whose `closedAt` is nearest `at`, within ±`windowDays`,
 * among those `accept` allows (e.g. "the skill was assessable"). A tie goes to
 * the earlier cut — the practice the learner had already done when they
 * answered.
 */
export function nearestCut<C extends SelfEfficacyCut>(
  cuts: readonly C[],
  at: Date,
  accept: (cut: C) => boolean,
  windowDays = SELF_EFFICACY_MATCH_WINDOW_DAYS,
): C | null {
  const limit = windowDays * DAY_MS;
  let best: C | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cut of cuts) {
    const signed = cut.closedAt.getTime() - at.getTime();
    const distance = Math.abs(signed);
    if (distance > limit || !accept(cut)) continue;
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        best !== null &&
        cut.closedAt.getTime() < best.closedAt.getTime())
    ) {
      best = cut;
      bestDistance = distance;
    }
  }
  return best;
}

/** Ranks with ties given the mean of the positions they span (1-based). */
export function averageRanks(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].i] = rank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rank correlation (Pearson on average ranks, so ties are handled
 * properly — and on a 0–10 against a 1–4 scale nearly everything ties). Null
 * below `minPoints` or when either side does not vary.
 */
export function spearman(
  xs: readonly number[],
  ys: readonly number[],
  minPoints = SELF_EFFICACY_MIN_SPEARMAN_POINTS,
): number | null {
  const n = xs.length;
  if (n !== ys.length || n < Math.max(2, minPoints)) return null;
  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const mx = mean(rx);
  const my = mean(ry);
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

// ─────────────────────────────────────────────────────────────────────────────
// EFF-71 · Confidence start → now
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfidenceGroupResult {
  /** Learners paired (first vs latest answer that both answered a common item). */
  learners: number;
  /** Self-rating (0–10), first vs latest, over every paired learner. */
  self: FlooredPairedComparison;
  /** Self-rating over the judge-matched subset, on the same skills as `judge`. */
  selfMatched: FlooredPairedComparison;
  /** Judged level (1–4) at the cuts nearest the same two answers, same people and skills. */
  judge: FlooredPairedComparison;
  /** Median days between the first and latest answer; null below the floor. */
  medianDaysApart: number | null;
}

/**
 * One group (a tier, or one skill): each learner's FIRST vs LATEST answer that
 * answered at least one of the group's items, over the items answered BOTH
 * times — the same questions revisited, so a skipped item cannot move the
 * mean. The judge side takes, for the same learner, the cut nearest each of
 * the two answers (within the window) where any of those skills was
 * assessable; the two cuts must differ (the same cut either side would
 * measure no practice and pull the change to zero), and the judge compares
 * the skills assessable in BOTH cuts, with `selfMatched` restricted to those
 * same skills and people.
 */
export function confidenceChange(
  answersByLearner: ReadonlyMap<number, readonly SelfEfficacyAnswer[]>,
  cutsByLearner: ReadonlyMap<number, readonly SelfEfficacyCut[]>,
  groupSkills: readonly string[],
  floor: number,
  windowDays = SELF_EFFICACY_MATCH_WINDOW_DAYS,
): ConfidenceGroupResult {
  const before: number[] = [];
  const after: number[] = [];
  const days: number[] = [];
  const selfB: number[] = [];
  const selfA: number[] = [];
  const judgeB: number[] = [];
  const judgeA: number[] = [];

  for (const [userId, answers] of answersByLearner) {
    const inGroup = answers.filter((a) =>
      groupSkills.some((k) => has(a.responses, k)),
    );
    if (inGroup.length < 2) continue;
    const first = inGroup[0];
    const latest = inGroup[inGroup.length - 1];
    const common = groupSkills.filter(
      (k) => has(first.responses, k) && has(latest.responses, k),
    );
    if (!common.length) continue;

    before.push(mean(common.map((k) => first.responses[k])));
    after.push(mean(common.map((k) => latest.responses[k])));
    days.push(
      (latest.answeredAt.getTime() - first.answeredAt.getTime()) / DAY_MS,
    );

    const cuts = cutsByLearner.get(userId) ?? [];
    const assessable = (c: SelfEfficacyCut) =>
      common.some((k) => has(c.levels, k));
    const cutA = nearestCut(cuts, first.answeredAt, assessable, windowDays);
    const cutB = nearestCut(cuts, latest.answeredAt, assessable, windowDays);
    if (!cutA || !cutB || cutA === cutB) continue;
    const judged = common.filter(
      (k) => has(cutA.levels, k) && has(cutB.levels, k),
    );
    if (!judged.length) continue;
    selfB.push(mean(judged.map((k) => first.responses[k])));
    selfA.push(mean(judged.map((k) => latest.responses[k])));
    judgeB.push(mean(judged.map((k) => Number(cutA.levels[k]))));
    judgeA.push(mean(judged.map((k) => Number(cutB.levels[k]))));
  }

  const md = median(days);
  return {
    learners: before.length,
    self: flooredPairedComparison(before, after, floor),
    selfMatched: flooredPairedComparison(selfB, selfA, floor),
    judge: flooredPairedComparison(judgeB, judgeA, floor),
    medianDaysApart:
      before.length >= floor && md !== null ? round(md, 1) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EFF-72 · Confidence against competence
// ─────────────────────────────────────────────────────────────────────────────

/** One (learner, answer, skill) matched to a judged level. */
export interface CalibrationObservation {
  userId: number;
  skill: string;
  answeredAt: Date;
  /** Position of the answer in the input, to group one answer's skills. */
  answerIndex: number;
  selfRating: number;
  rescaled: number;
  level: number;
  gap: number;
}

export interface CalibrationStats {
  /** Learners in the classification (one point each: their latest matched answer). */
  learners: number;
  overConfident: number;
  calibrated: number;
  underConfident: number;
  overConfidentPct: number | null;
  calibratedPct: number | null;
  underConfidentPct: number | null;
  /** Mean of the learners' gaps (rescaled self − level, rubric levels); null below the floor. */
  meanGap: number | null;
  meanGapCi: [number, number] | null;
  spearmanR: number | null;
}

/**
 * Every answered item matched to the learner's nearest cut (within the
 * window) in which that skill was assessable; items with no such cut are
 * counted in `unmatched`.
 */
export function matchObservations(
  answers: readonly SelfEfficacyAnswer[],
  cutsByLearner: ReadonlyMap<number, readonly SelfEfficacyCut[]>,
  windowDays = SELF_EFFICACY_MATCH_WINDOW_DAYS,
): { observations: CalibrationObservation[]; unmatched: number } {
  const observations: CalibrationObservation[] = [];
  let unmatched = 0;
  answers.forEach((answer, answerIndex) => {
    const cuts = cutsByLearner.get(answer.userId) ?? [];
    for (const [skill, selfRating] of Object.entries(answer.responses)) {
      const cut = nearestCut(
        cuts,
        answer.answeredAt,
        (c) => has(c.levels, skill),
        windowDays,
      );
      if (!cut) {
        unmatched += 1;
        continue;
      }
      const level = Number(cut.levels[skill]);
      const rescaled = rescaleSelfRating(selfRating);
      observations.push({
        userId: answer.userId,
        skill,
        answeredAt: answer.answeredAt,
        answerIndex,
        selfRating,
        rescaled,
        level,
        gap: rescaled - level,
      });
    }
  });
  return { observations, unmatched };
}

/** Classification, shares, mean gap and rank correlation over one point per learner. */
export function calibrationStats(
  points: readonly { self: number; level: number; gap: number }[],
  floor: number,
  minSpearmanPoints = SELF_EFFICACY_MIN_SPEARMAN_POINTS,
  band = SELF_EFFICACY_CALIBRATION_BAND,
): CalibrationStats {
  const n = points.length;
  const counts = { overConfident: 0, calibrated: 0, underConfident: 0 };
  for (const p of points) counts[classifyCalibration(p.gap, band)] += 1;
  const enough = n >= floor;
  const pct = (k: number) => (enough ? round((100 * k) / n, 1) : null);
  const gaps = points.map((p) => p.gap);
  const ci = enough ? bootstrapMeanCi(gaps) : null;
  const r = enough
    ? spearman(
        points.map((p) => p.self),
        points.map((p) => p.level),
        minSpearmanPoints,
      )
    : null;
  return {
    learners: n,
    ...counts,
    overConfidentPct: pct(counts.overConfident),
    calibratedPct: pct(counts.calibrated),
    underConfidentPct: pct(counts.underConfident),
    meanGap: enough && n ? round(mean(gaps), 2) : null,
    meanGapCi: ci ? [round(ci[0], 2), round(ci[1], 2)] : null,
    spearmanR: r === null ? null : round(r, 2),
  };
}

/** Each learner's latest observation of one skill. */
export function latestPerLearner(
  observations: readonly CalibrationObservation[],
  skill: string,
): CalibrationObservation[] {
  const latest = new Map<number, CalibrationObservation>();
  for (const o of observations) {
    if (o.skill !== skill) continue;
    const cur = latest.get(o.userId);
    if (!cur || o.answeredAt.getTime() >= cur.answeredAt.getTime()) {
      latest.set(o.userId, o);
    }
  }
  return [...latest.values()];
}

/**
 * Pooled across skills: each learner's latest answer with any matched skill,
 * as the mean rescaled self-rating and the mean judged level over its matched
 * skills (`self` is reported back on 0–10 so it reads like the per-skill rows).
 */
export function overallPerLearner(
  observations: readonly CalibrationObservation[],
): { self: number; level: number; gap: number }[] {
  const latestAnswer = new Map<number, { at: number; index: number }>();
  for (const o of observations) {
    const cur = latestAnswer.get(o.userId);
    const at = o.answeredAt.getTime();
    if (!cur || at > cur.at || (at === cur.at && o.answerIndex > cur.index)) {
      latestAnswer.set(o.userId, { at, index: o.answerIndex });
    }
  }
  const out: { self: number; level: number; gap: number }[] = [];
  for (const [userId, { index }] of latestAnswer) {
    const obs = observations.filter(
      (o) => o.userId === userId && o.answerIndex === index,
    );
    const rescaled = mean(obs.map((o) => o.rescaled));
    const level = mean(obs.map((o) => o.level));
    out.push({
      self: mean(obs.map((o) => o.selfRating)),
      level,
      gap: rescaled - level,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The whole build
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfEfficacyBuildOptions {
  floor: number;
  windowDays?: number;
  band?: number;
  minSpearmanPoints?: number;
  pointCap?: number;
}

export interface SelfEfficacyBuild {
  coverage: {
    responses: number;
    answeredResponses: number;
    dismissedResponses: number;
    byTrigger: Record<string, number>;
    learnersAsked: number;
    learnersAnswered: number;
    learnersWithTwoOrMore: number;
    itemsAnswered: number;
    matchedObservations: number;
    unmatchedObservations: number;
  };
  confidence: {
    tiers: ({ tier: FhsTier; skills: string[] } & ConfidenceGroupResult)[];
    skills: ({ skill: string; tier: FhsTier } & ConfidenceGroupResult)[];
  };
  calibration: {
    skills: ({
      skill: string;
      tier: FhsTier;
      observations: number;
    } & CalibrationStats)[];
    overall: CalibrationStats & { observations: number };
    points: { skill: string; selfRating: number; level: number }[];
    pointsTotal: number;
    pointsTruncated: boolean;
  };
}

const TIER_ORDER: readonly FhsTier[] = ['engage', 'understand', 'support'];

/**
 * Everything both cards need, from every stored answer of one instrument
 * version and every scored cut of one rubric version (both already scoped and
 * test-org-free). Scatter points are returned only for skills that clear the
 * floor — below it the shares are withheld, and the dots would be the same
 * small-n result drawn instead of printed.
 */
export function buildSelfEfficacy(
  instrument: SelfEfficacyInstrument,
  rawAnswers: readonly SelfEfficacyAnswer[],
  cuts: readonly SelfEfficacyCut[],
  opts: SelfEfficacyBuildOptions,
): SelfEfficacyBuild {
  const windowDays = opts.windowDays ?? SELF_EFFICACY_MATCH_WINDOW_DAYS;
  const band = opts.band ?? SELF_EFFICACY_CALIBRATION_BAND;
  const minSpearman =
    opts.minSpearmanPoints ?? SELF_EFFICACY_MIN_SPEARMAN_POINTS;
  const cap = opts.pointCap ?? SELF_EFFICACY_POINT_CAP;
  const skillSet = new Set(instrument.items.map((i) => i.skill));

  // Coverage counts every stored row, dismissals included.
  const byTrigger: Record<string, number> = {
    ONBOARDING: 0,
    CUTS: 0,
    COURSE: 0,
  };
  const asked = new Set<number>();
  const answeredCount = new Map<number, number>();
  const answers: SelfEfficacyAnswer[] = [];
  let itemsAnswered = 0;
  for (const raw of rawAnswers) {
    byTrigger[raw.trigger] = (byTrigger[raw.trigger] ?? 0) + 1;
    asked.add(raw.userId);
    const responses = answeredItems(raw.responses, skillSet);
    const items = Object.keys(responses).length;
    if (!items) continue;
    itemsAnswered += items;
    answeredCount.set(raw.userId, (answeredCount.get(raw.userId) ?? 0) + 1);
    answers.push({ ...raw, responses });
  }

  const answersByLearner = byLearner(answers, (a) => a.answeredAt);
  const cutsByLearner = byLearner(cuts, (c) => c.closedAt);

  const tiers = TIER_ORDER.map((tier) => {
    const skills = instrument.items
      .filter((i) => i.tier === tier)
      .map((i) => i.skill);
    return {
      tier,
      skills,
      ...confidenceChange(
        answersByLearner,
        cutsByLearner,
        skills,
        opts.floor,
        windowDays,
      ),
    };
  });
  const confidenceSkills = instrument.items.map((i) => ({
    skill: i.skill,
    tier: i.tier,
    ...confidenceChange(
      answersByLearner,
      cutsByLearner,
      [i.skill],
      opts.floor,
      windowDays,
    ),
  }));

  const { observations, unmatched } = matchObservations(
    answers,
    cutsByLearner,
    windowDays,
  );
  const calibrationSkills = instrument.items.map((i) => {
    const latest = latestPerLearner(observations, i.skill);
    return {
      skill: i.skill,
      tier: i.tier,
      observations: observations.filter((o) => o.skill === i.skill).length,
      ...calibrationStats(
        latest.map((o) => ({ self: o.selfRating, level: o.level, gap: o.gap })),
        opts.floor,
        minSpearman,
        band,
      ),
    };
  });
  const overall = {
    observations: observations.length,
    ...calibrationStats(
      overallPerLearner(observations),
      opts.floor,
      minSpearman,
      band,
    ),
  };

  const shownSkills = new Set(
    calibrationSkills
      .filter((s) => s.learners >= opts.floor)
      .map((s) => s.skill),
  );
  const shown = observations
    .filter((o) => shownSkills.has(o.skill))
    .sort(
      (a, b) =>
        b.answeredAt.getTime() - a.answeredAt.getTime() ||
        a.skill.localeCompare(b.skill),
    );

  return {
    coverage: {
      responses: rawAnswers.length,
      answeredResponses: answers.length,
      dismissedResponses: rawAnswers.length - answers.length,
      byTrigger,
      learnersAsked: asked.size,
      learnersAnswered: answeredCount.size,
      learnersWithTwoOrMore: [...answeredCount.values()].filter((c) => c >= 2)
        .length,
      itemsAnswered,
      matchedObservations: observations.length,
      unmatchedObservations: unmatched,
    },
    confidence: { tiers, skills: confidenceSkills },
    calibration: {
      skills: calibrationSkills,
      overall,
      points: shown.slice(0, cap).map((o) => ({
        skill: o.skill,
        selfRating: o.selfRating,
        level: o.level,
      })),
      pointsTotal: observations.length,
      pointsTruncated: shown.length > cap,
    },
  };
}
