import type { FoundationalSkillsLearnerCutRow } from '../repository/foundational-skills-analytics.repository';
import {
  EffectivenessLearner,
  groupCutRows,
  segmentChange,
} from './effectiveness.util';
import {
  FHS_PROGRESS_THRESHOLDS,
  LearnerTrend,
  computeProgress,
  cutNoiseSd,
  learnerTrend,
} from './foundational-skills-progress.util';

/**
 * The arithmetic behind two Effectiveness views that read EVERY learner at
 * once:
 *
 *  - **EFF-90 · Org effectiveness scorecard** (AAQ-232, Orgs sub-tab) — per
 *    non-test org: who is measurable, their own first-half → last-half change,
 *    the share improving beyond noise, unhelpful-behaviour change, course
 *    completion and (internal) self-harm cue follow-up.
 *  - **EFF-61 · Cost per improved learner** (AAQ-218, Effectiveness sub-tab) —
 *    learner-caused AI spend in a window over the learners whose improvement
 *    "landed" in it.
 *
 * Pure functions over rows the repositories return, so the floors, the
 * org attribution and the window membership are unit-tested without a
 * database. Nothing here re-derives a band or an interval: the noise and the
 * trend class are `foundational-skills-progress.util`'s (`cutNoiseSd`,
 * `learnerTrend` — the Helping skills AAQ-181 classification), the paired
 * change is `effectiveness.util`'s `segmentChange` (AAQ-168's flooring), and the
 * self-harm cue verdicts come from `computeProgress` itself, so no number here
 * can disagree with the Helping skills card it summarises.
 */

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Median by linear interpolation (Postgres `percentile_cont(0.5)`). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) / 2;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* -------------------------------------------------------------------------- */
/* Org attribution                                                            */
/* -------------------------------------------------------------------------- */

/** A live, non-test org the scorecard can have a row for. */
export interface OrgTenant {
  /** tenants.id (uuid). */
  id: string;
  name: string;
  code: string | null;
}

/**
 * Every spelling a `tenant_id` column may hold (the uuid OR the tenant code)
 * → the tenant's uuid, so an org whose cuts carry both spellings is one row.
 * The JS twin of the `(t.id::text = x OR t.code = x)` join.
 */
export function tenantAliasMap(
  tenants: readonly OrgTenant[],
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const t of tenants) {
    aliases.set(t.id, t.id);
    if (t.code) aliases.set(t.code, t.id);
  }
  return aliases;
}

/** Enrolment counts for one raw `users.tenant_id` value. */
export interface OrgEnrolmentRow {
  /** Raw `users.tenant_id` (uuid or code); null for a tenantless user. */
  tenantRef: string | null;
  /** Enrolments the learner started (opened or completed an item). */
  started: number;
  /** Started enrolments with `completedAt` set. */
  completed: number;
  /** Distinct learners behind `started`. */
  learnersStarted: number;
}

/* -------------------------------------------------------------------------- */
/* EFF-90 · per-org metrics                                                   */
/* -------------------------------------------------------------------------- */

/** Months on the scorecard sparkline (the current month included). */
export const ORG_SPARK_MONTHS = 6;

/** Cuts a month needs before its median composite is drawn. */
export const ORG_SPARK_MIN_CUTS = 5;

const monthKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

/**
 * The sparkline's shared axis: `count` calendar months ending with the month
 * that contains `now`, oldest first, as `yyyy-mm-01` (UTC).
 */
export function sparkMonthsEnding(
  now: Date,
  count: number = ORG_SPARK_MONTHS,
): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(
      monthKey(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)),
      ),
    );
  }
  return out;
}

/** A paired own-baseline change, with neutral names for the averages either side. */
export interface OrgChange {
  learners: number;
  earlyAvg: number | null;
  lateAvg: number | null;
  change: number | null;
  ci: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  detectable: boolean;
}

/** `segmentChange` (AAQ-168's flooring), with the averages renamed. */
function orgChange(
  early: readonly number[],
  late: readonly number[],
  floor: number,
): OrgChange {
  const { earlyComposite, lateComposite, ...rest } = segmentChange(
    early,
    late,
    floor,
  );
  return { ...rest, earlyAvg: earlyComposite, lateAvg: lateComposite };
}

export interface OrgTrendMix {
  classifiable: number;
  improving: number;
  steady: number;
  declining: number;
  /** 4+ cuts but no platform noise estimate to compare against. */
  unclassified: number;
  improvingPct: number | null;
  steadyPct: number | null;
  decliningPct: number | null;
}

export interface OrgCourses {
  learnersStarted: number;
  started: number;
  completed: number;
  completionPct: number | null;
}

export interface OrgSelfHarm {
  internal: true;
  learnersWithCue: number;
  cutsWithCue: number;
  cutsFollowedUp: number;
  cutsMissed: number;
  cutsAmbiguous: number;
  followedUpPct: number | null;
}

export interface OrgMetrics {
  scoredLearners: number;
  measurableLearners: number;
  classifiableLearners: number;
  scoredCuts: number;
  belowFloor: boolean;
  composite: OrgChange;
  trend: OrgTrendMix;
  unhelpful: OrgChange;
  courses: OrgCourses;
  selfHarm: OrgSelfHarm;
  spark: (number | null)[];
  sparkCuts: number[];
}

/**
 * A learner's first and last ⌊k/2⌋ scored cuts — the halves `learnerTrend`
 * compares, so `late − early` here is exactly its `change`.
 */
function halves(l: EffectivenessLearner): {
  early: EffectivenessLearner['cuts'];
  late: EffectivenessLearner['cuts'];
} {
  const k = l.cuts.length;
  const w = Math.floor(k / 2);
  return { early: l.cuts.slice(0, w), late: l.cuts.slice(k - w) };
}

/** Share (0–100) of cuts with an unhelpful behaviour, among cuts that say. */
function unhelpfulShare(cuts: EffectivenessLearner['cuts']): number | null {
  const flagged = cuts.filter((c) => c.unhelpful !== null);
  if (!flagged.length) return null;
  return (flagged.filter((c) => c.unhelpful).length / flagged.length) * 100;
}

const emptySelfHarm = (): Omit<OrgSelfHarm, 'internal' | 'followedUpPct'> => ({
  learnersWithCue: 0,
  cutsWithCue: 0,
  cutsFollowedUp: 0,
  cutsMissed: 0,
  cutsAmbiguous: 0,
});

/**
 * Everything one scorecard row says, over one org's learners (each carrying
 * only the cuts that closed in that org).
 *
 * - **measurable** = 2+ scored cuts; **classifiable** = `trendMinCuts`+.
 * - **Row floor**: below `sampleFloor` measurable learners every rate is
 *   null (`belowFloor`) and every count still travels.
 * - **composite / unhelpful**: each classifiable learner's own first half vs
 *   last half (the `learnerTrend` windows), paired over learners with
 *   `segmentChange` — so each needs `sampleFloor` learners on its own too.
 *   Unhelpful is each learner's share of slices with an unhelpful behaviour,
 *   in percentage points.
 * - **trend**: `learnerTrend` against the PLATFORM noise passed in, so every
 *   org is held to the same band; shares need `sampleFloor` classifiable
 *   learners (as the Effectiveness funnel's trend mix).
 * - **courses**: completed ÷ started enrolments; needs the row floor and
 *   `sampleFloor` started enrolments.
 * - **self-harm**: `computeProgress`'s cue verdicts; followed-up share =
 *   followed ÷ (followed + missed) cuts, unclear cuts left out; needs the row
 *   floor and `minCohort` learners who met a cue. Internal.
 * - **spark**: median cut composite per calendar month of cut close; null in a
 *   month with fewer than {@link ORG_SPARK_MIN_CUTS} cuts and in every month of
 *   a below-floor row (the per-month cut counts still travel).
 */
export function orgMetrics(
  learners: readonly EffectivenessLearner[],
  ctx: {
    noise: number | null;
    enrolment: Omit<OrgEnrolmentRow, 'tenantRef'>;
    months: readonly string[];
    sampleFloor: number;
    minCohort: number;
  },
): OrgMetrics {
  const { noise, sampleFloor, minCohort } = ctx;
  const scored = learners.filter((l) => l.cuts.length >= 1);
  const measurable = scored.filter((l) => l.cuts.length >= 2);
  const classifiable = measurable.filter(
    (l) => l.cuts.length >= FHS_PROGRESS_THRESHOLDS.trendMinCuts,
  );
  const belowFloor = measurable.length < sampleFloor;

  // ── Own first half → last half, paired over classifiable learners ────────
  const earlyComp: number[] = [];
  const lateComp: number[] = [];
  const earlyUnh: number[] = [];
  const lateUnh: number[] = [];
  const mix: Record<
    Exclude<LearnerTrend, 'tooEarly'> | 'unclassified',
    number
  > = { improving: 0, steady: 0, declining: 0, unclassified: 0 };
  for (const l of classifiable) {
    const { early, late } = halves(l);
    earlyComp.push(mean(early.map((c) => c.score)) as number);
    lateComp.push(mean(late.map((c) => c.score)) as number);
    const eu = unhelpfulShare(early);
    const lu = unhelpfulShare(late);
    if (eu !== null && lu !== null) {
      earlyUnh.push(eu);
      lateUnh.push(lu);
    }
    const t = learnerTrend(l, noise).trend;
    if (t === 'tooEarly') mix.unclassified += 1;
    else mix[t] += 1;
  }
  const trendShown = classifiable.length >= sampleFloor;
  const trendPct = (k: number) =>
    trendShown ? round1((k / classifiable.length) * 100) : null;

  // ── Courses ──────────────────────────────────────────────────────────────
  const { started, completed, learnersStarted } = ctx.enrolment;
  const completionPct =
    !belowFloor && started >= sampleFloor && started > 0
      ? round1((completed / started) * 100)
      : null;

  // ── Self-harm cues: computeProgress's verdicts, never re-derived ─────────
  const sh = learners.length
    ? computeProgress(learners, { sampleFloor, minCohort }).safety.selfHarm
    : emptySelfHarm();
  const clear = sh.cutsFollowedUp + sh.cutsMissed;
  const followedUpPct =
    !belowFloor && sh.learnersWithCue >= minCohort && clear > 0
      ? round1((sh.cutsFollowedUp / clear) * 100)
      : null;

  // ── Spark: median composite by month of cut close ────────────────────────
  const byMonth = new Map<string, number[]>(ctx.months.map((m) => [m, []]));
  let scoredCuts = 0;
  for (const l of learners) {
    for (const c of l.cuts) {
      scoredCuts += 1;
      const closedAt = l.facts.get(c.cut)?.closedAt;
      if (!closedAt) continue;
      byMonth.get(monthKey(closedAt))?.push(c.score);
    }
  }
  const sparkCuts = ctx.months.map((m) => byMonth.get(m)?.length ?? 0);
  const spark = ctx.months.map((m) => {
    const xs = byMonth.get(m) ?? [];
    if (belowFloor || xs.length < ORG_SPARK_MIN_CUTS) return null;
    return round2(median(xs) as number);
  });

  return {
    scoredLearners: scored.length,
    measurableLearners: measurable.length,
    classifiableLearners: classifiable.length,
    scoredCuts,
    belowFloor,
    composite: orgChange(earlyComp, lateComp, sampleFloor),
    trend: {
      classifiable: classifiable.length,
      improving: mix.improving,
      steady: mix.steady,
      declining: mix.declining,
      unclassified: mix.unclassified,
      improvingPct: trendPct(mix.improving),
      steadyPct: trendPct(mix.steady),
      decliningPct: trendPct(mix.declining),
    },
    unhelpful: orgChange(earlyUnh, lateUnh, sampleFloor),
    courses: { learnersStarted, started, completed, completionPct },
    selfHarm: {
      internal: true,
      learnersWithCue: sh.learnersWithCue,
      cutsWithCue: sh.cutsWithCue,
      cutsFollowedUp: sh.cutsFollowedUp,
      cutsMissed: sh.cutsMissed,
      cutsAmbiguous: sh.cutsAmbiguous,
      followedUpPct,
    },
    spark,
    sparkCuts,
  };
}

export interface OrgScorecardRow extends OrgMetrics {
  tenantId: string;
  tenantName: string;
  code: string | null;
}

export interface OrgScorecard {
  cutNoiseSd: number | null;
  months: string[];
  platform: OrgMetrics;
  orgs: OrgScorecardRow[];
  summary: {
    orgs: number;
    orgsWithData: number;
    orgsAboveFloor: number;
    cutsUnattributed: number;
    learnersUnattributed: number;
  };
}

const sumEnrolment = (
  rows: readonly OrgEnrolmentRow[],
): Omit<OrgEnrolmentRow, 'tenantRef'> =>
  rows.reduce(
    (a, r) => ({
      started: a.started + r.started,
      completed: a.completed + r.completed,
      learnersStarted: a.learnersStarted + r.learnersStarted,
    }),
    { started: 0, completed: 0, learnersStarted: 0 },
  );

/**
 * The whole scorecard in one pass over every scored cut.
 *
 * - The noise band is estimated ONCE over every learner on the platform
 *   (`cutNoiseSd`, as AAQ-181), so a small org is not judged against its own
 *   handful of slices.
 * - A cut belongs to the org its `tenant_id` resolves to (uuid or code); a
 *   learner who moved orgs contributes to each org only the cuts that closed
 *   there — practice done elsewhere is not credited to this org, the same rule
 *   as the Helping skills org filter. Cuts whose tenant resolves to no live,
 *   non-test org are counted in `summary`, never silently dropped.
 * - Course completion is attributed by the LEARNER's org (`users.tenant_id`),
 *   as course impact scopes it.
 * - An org gets a row once it has a scored cut or a started enrolment.
 *   `tenantId` (uuid or code) narrows the rows returned; the noise, the
 *   platform row and `summary` stay platform-wide.
 * - Rows sort by measurable learners, then scored learners, then name — never
 *   by a rate.
 */
export function buildOrgScorecard(input: {
  rows: readonly FoundationalSkillsLearnerCutRow[];
  tenants: readonly OrgTenant[];
  enrolments: readonly OrgEnrolmentRow[];
  now: Date;
  sampleFloor: number;
  minCohort: number;
  tenantId?: string;
}): OrgScorecard {
  const { rows, tenants, enrolments, sampleFloor, minCohort } = input;
  const aliases = tenantAliasMap(tenants);
  const months = sparkMonthsEnding(input.now);

  const everyone = groupCutRows(rows);
  const noise = cutNoiseSd(everyone);

  const rowsByOrg = new Map<string, FoundationalSkillsLearnerCutRow[]>();
  let cutsUnattributed = 0;
  const usersUnattributed = new Set<number>();
  for (const row of rows) {
    const id = row.tenantId === null ? undefined : aliases.get(row.tenantId);
    if (id === undefined) {
      cutsUnattributed += 1;
      usersUnattributed.add(row.userId);
      continue;
    }
    const list = rowsByOrg.get(id) ?? [];
    list.push(row);
    rowsByOrg.set(id, list);
  }

  const enrolByOrg = new Map<string, OrgEnrolmentRow[]>();
  for (const e of enrolments) {
    const id = e.tenantRef === null ? undefined : aliases.get(e.tenantRef);
    if (id === undefined) continue;
    const list = enrolByOrg.get(id) ?? [];
    list.push(e);
    enrolByOrg.set(id, list);
  }

  const ctx = (enrolment: Omit<OrgEnrolmentRow, 'tenantRef'>) => ({
    noise,
    enrolment,
    months,
    sampleFloor,
    minCohort,
  });

  const all: OrgScorecardRow[] = [];
  for (const t of tenants) {
    const orgRows = rowsByOrg.get(t.id) ?? [];
    const enrolment = sumEnrolment(enrolByOrg.get(t.id) ?? []);
    if (orgRows.length === 0 && enrolment.started === 0) continue;
    all.push({
      tenantId: t.id,
      tenantName: t.name,
      code: t.code,
      ...orgMetrics(groupCutRows(orgRows), ctx(enrolment)),
    });
  }
  all.sort(
    (a, b) =>
      b.measurableLearners - a.measurableLearners ||
      b.scoredLearners - a.scoredLearners ||
      a.tenantName.localeCompare(b.tenantName) ||
      a.tenantId.localeCompare(b.tenantId),
  );

  const narrowed = input.tenantId
    ? all.filter(
        (r) => r.tenantId === input.tenantId || r.code === input.tenantId,
      )
    : all;

  return {
    cutNoiseSd: noise === null ? null : round3(noise),
    months,
    platform: orgMetrics(everyone, ctx(sumEnrolment(enrolments))),
    orgs: narrowed,
    summary: {
      orgs: tenants.length,
      orgsWithData: all.length,
      orgsAboveFloor: all.filter((r) => !r.belowFloor).length,
      cutsUnattributed,
      learnersUnattributed: usersUnattributed.size,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* EFF-61 · Cost per improved learner                                         */
/* -------------------------------------------------------------------------- */

/**
 * The exact `[start, endExclusive)` behind a window the roleplay-cost
 * endpoint echoed (`from`/`to` are inclusive `yyyy-mm-dd`), so this card's
 * window is byte-for-byte the one its numerator was summed over.
 */
export function windowBounds(window: { from: string; to: string }): {
  start: Date;
  endExclusive: Date;
} {
  const start = new Date(`${window.from}T00:00:00.000Z`);
  const to = new Date(`${window.to}T00:00:00.000Z`);
  return { start, endExclusive: new Date(to.getTime() + 86_400_000) };
}

export interface CostPerImprovement {
  spendUsd: number;
  improvedLearners: number;
  classifiedLearners: number;
  improvingAllTime: number;
  classifiableAllTime: number;
  measuredLearners: number;
  costPerImprovedLearnerUsd: number | null;
  cutNoiseSd: number | null;
}

/**
 * Spend ÷ learners whose improvement landed in the window.
 *
 * Every learner is classified over ALL of their scored cuts against the noise
 * of every learner (`learnerTrend` + `cutNoiseSd`, the Helping skills AAQ-181
 * classification). A learner counts in the denominator when they are
 * `improving` AND the cut that closes their "now" half — their last scored
 * cut — closed inside `[start, endExclusive)`. `classifiedLearners` is the
 * same membership rule without the improving condition. Below `sampleFloor`
 * improved learners the ratio is null; both sides always travel.
 */
export function buildCostPerImprovement(input: {
  rows: readonly FoundationalSkillsLearnerCutRow[];
  start: Date;
  endExclusive: Date;
  spendUsd: number;
  sampleFloor: number;
}): CostPerImprovement {
  const learners = groupCutRows(input.rows);
  const noise = cutNoiseSd(learners);
  const lo = input.start.getTime();
  const hi = input.endExclusive.getTime();

  let improved = 0;
  let classified = 0;
  let improvingAll = 0;
  let classifiableAll = 0;
  for (const l of learners) {
    const { trend } = learnerTrend(l, noise);
    if (trend === 'tooEarly') continue;
    classifiableAll += 1;
    if (trend === 'improving') improvingAll += 1;
    const last = l.cuts[l.cuts.length - 1];
    const closedAt = l.facts.get(last.cut)?.closedAt?.getTime();
    if (closedAt === undefined || closedAt < lo || closedAt >= hi) continue;
    classified += 1;
    if (trend === 'improving') improved += 1;
  }

  const spendUsd = round2(input.spendUsd);
  return {
    spendUsd,
    improvedLearners: improved,
    classifiedLearners: classified,
    improvingAllTime: improvingAll,
    classifiableAllTime: classifiableAll,
    measuredLearners: learners.length,
    costPerImprovedLearnerUsd:
      improved >= input.sampleFloor && improved > 0
        ? round2(input.spendUsd / improved)
        : null,
    cutNoiseSd: noise === null ? null : round3(noise),
  };
}
