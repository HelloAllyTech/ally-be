import { FHS_RUBRIC } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { COURSE_IMPACT_COMPETENCY_SKILLS } from '../constants/course-impact.constants';
import type { FoundationalSkillsLearnerCutRow } from '../repository/foundational-skills-analytics.repository';
import { flooredPairedComparison, signTestP } from './paired-stats.util';

/**
 * The arithmetic behind the Curriculum sub-tab's "Scenarios" section: does each
 * scenario create an opportunity for the skills it is tagged with (EFF-30/31,
 * AAQ-214/215), and does a learner's session score rise when they replay the
 * same scenario (EFF-33, AAQ-216)?
 *
 * Pure functions over the rows the repositories return, so the single-scenario
 * rule, the tag mapping, the pairing rule and every floor are unit-tested
 * without a database.
 *
 * ## Where "opportunity" comes from
 *
 * A stored assessment records it twice, and the two can never disagree:
 * `verdicts[].opportunity` is the judge's call per skill, and `skillLevels`
 * holds a level for exactly the skills whose verdict had one (the writer,
 * `storedJudgement` in src/foundational-skills/util/skill-scoring.util.ts,
 * builds `skillLevels` from the verdicts with a non-null level, and a level is
 * non-null iff `opportunity` is true). This file reads `skillLevels` key
 * presence — the reading the Helping skills tab already uses for "learners with
 * a chance at each skill" (AAQ-178) — so the two cards cannot count the same cut
 * differently.
 */

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** A scored cut, as much of it as attribution and opportunity need. */
export type CoverageCut = Pick<
  FoundationalSkillsLearnerCutRow,
  'userId' | 'levels' | 'sessionIds'
>;

/** One competency a scenario is tagged with, by name. */
export interface ScenarioTagRow {
  scenarioId: number;
  name: string;
  /** User-owned variant named `{userId}_custom_{n}`: says nothing about which skill it means. */
  isCustom: boolean;
}

/** Title and all-time countable-session count of one scenario. */
export interface ScenarioMetaRow {
  scenarioId: number;
  title: string | null;
  sessionsPlayed: number;
}

/** Thresholds for the tag-gap list (EFF-31), served in the payload. */
export const SCENARIO_TAG_GAP_THRESHOLDS = {
  /** A tagged skill whose opportunity share is below this (%) is a gap… */
  maxOpportunityPct: 30,
  /** …provided the share rests on at least this many single-scenario cuts. */
  minCuts: 20,
} as const;

/** Replays must span at least this long before first vs latest counts as a pair. */
export const REPEAT_MIN_SPAN_MS = 86_400_000;

/** Scenarios offered in the slope chart's picker. */
export const REPEAT_PICKER_SIZE = 10;

export const UNTITLED_SCENARIO = 'Untitled scenario';

/* -------------------------------------------------------------------------- */
/* Opportunity coverage (EFF-30 / EFF-31)                                     */
/* -------------------------------------------------------------------------- */

/**
 * The scenario a cut belongs to, or null when it cannot be given one.
 *
 * A cut is 5,000 characters of a learner's speech and can span sessions. It is
 * attributed only when EVERY session it touches is known and played the same
 * scenario — the plan's single-scenario rule. A cut with a session that can no
 * longer be found, or one that crosses two scenarios, is left out rather than
 * credited to the scenario that contributed most: a cell that mixes scenarios
 * says nothing about either.
 */
export function singleScenarioOf(
  sessionIds: readonly string[],
  scenarioBySession: ReadonlyMap<string, number | null>,
): number | null {
  if (sessionIds.length === 0) return null;
  let scenario: number | null = null;
  for (const id of sessionIds) {
    const s = scenarioBySession.get(id);
    if (s === undefined || s === null) return null;
    if (scenario === null) scenario = s;
    else if (s !== scenario) return null;
  }
  return scenario;
}

/**
 * A scenario's competency tags as rubric skill keys, through the seeded-name
 * table the course-impact card already uses (`COURSE_IMPACT_COMPETENCY_SKILLS`).
 * Skills come back in rubric order; seeded names with no rubric key (e.g.
 * "Linking Emotions, Thoughts & Behaviours", "Non-Verbal Communication", or an
 * admin-created competency) are listed by name so the gap is visible; custom
 * competencies are only counted — their names identify their owner, not a skill.
 */
export function mapScenarioTags(
  tags: readonly Pick<ScenarioTagRow, 'name' | 'isCustom'>[],
): {
  taggedSkills: string[];
  untranslatableTags: string[];
  customTags: number;
} {
  const keys = new Set<string>();
  const untranslatable = new Set<string>();
  let customTags = 0;
  for (const tag of tags) {
    if (tag.isCustom) {
      customTags += 1;
      continue;
    }
    const key = COURSE_IMPACT_COMPETENCY_SKILLS[tag.name];
    if (key) keys.add(key);
    else untranslatable.add(tag.name);
  }
  return {
    taggedSkills: FHS_RUBRIC.map((s) => s.key).filter((k) => keys.has(k)),
    untranslatableTags: [...untranslatable].sort((a, b) => a.localeCompare(b)),
    customTags,
  };
}

const hasOpportunity = (levels: Record<string, number>, skill: string) =>
  Object.prototype.hasOwnProperty.call(levels, skill) &&
  Number.isFinite(Number(levels[skill]));

export interface OpportunityCellOut {
  skill: string;
  /** True when the scenario is tagged with this skill. */
  tagged: boolean;
  /** Single-scenario cuts where the skill had an opportunity. */
  opportunities: number;
  opportunityPct: number | null;
}

export interface OpportunityRowOut {
  scenarioId: number;
  title: string;
  cuts: number;
  learners: number;
  sessionsPlayed: number;
  taggedSkills: string[];
  untranslatableTags: string[];
  customTags: number;
  cells: OpportunityCellOut[];
}

export interface TagGapOut {
  scenarioId: number;
  title: string;
  skill: string;
  opportunityPct: number;
  cuts: number;
  sessionsPlayed: number;
}

export interface OpportunityCoverageOut {
  scoredCuts: number;
  singleScenarioCuts: number;
  singleScenarioShare: number | null;
  scenarios: OpportunityRowOut[];
  belowFloor: { scenarioId: number; title: string; cuts: number }[];
  tagGaps: TagGapOut[];
}

/**
 * Rows = scenarios with at least `floor` single-scenario cuts; columns = the 14
 * rubric skills; cell = the share of those cuts that gave the skill an
 * opportunity. Scenarios under the floor are listed compactly with their n.
 * `tagGaps` is the content team's fix list: a TAGGED skill that the scenario's
 * cuts rarely give an opportunity for, most-played scenario first.
 */
export function buildOpportunityCoverage(
  cuts: readonly CoverageCut[],
  scenarioBySession: ReadonlyMap<string, number | null>,
  meta: readonly ScenarioMetaRow[],
  tags: readonly ScenarioTagRow[],
  opts: { floor: number; gapMaxPct: number; gapMinCuts: number },
): OpportunityCoverageOut {
  const byScenario = new Map<number, CoverageCut[]>();
  for (const cut of cuts) {
    const scenarioId = singleScenarioOf(cut.sessionIds, scenarioBySession);
    if (scenarioId === null) continue;
    const list = byScenario.get(scenarioId);
    if (list) list.push(cut);
    else byScenario.set(scenarioId, [cut]);
  }
  const singleScenarioCuts = [...byScenario.values()].reduce(
    (n, list) => n + list.length,
    0,
  );

  const metaById = new Map(meta.map((m) => [m.scenarioId, m]));
  const tagsById = new Map<number, ScenarioTagRow[]>();
  for (const tag of tags) {
    const list = tagsById.get(tag.scenarioId);
    if (list) list.push(tag);
    else tagsById.set(tag.scenarioId, [tag]);
  }
  const titleOf = (id: number) => metaById.get(id)?.title || UNTITLED_SCENARIO;

  const scenarios: OpportunityRowOut[] = [];
  const belowFloor: OpportunityCoverageOut['belowFloor'] = [];
  for (const [scenarioId, list] of byScenario) {
    if (list.length < opts.floor) {
      belowFloor.push({
        scenarioId,
        title: titleOf(scenarioId),
        cuts: list.length,
      });
      continue;
    }
    const mapped = mapScenarioTags(tagsById.get(scenarioId) ?? []);
    const tagged = new Set(mapped.taggedSkills);
    scenarios.push({
      scenarioId,
      title: titleOf(scenarioId),
      cuts: list.length,
      learners: new Set(list.map((c) => c.userId)).size,
      sessionsPlayed: metaById.get(scenarioId)?.sessionsPlayed ?? 0,
      ...mapped,
      cells: FHS_RUBRIC.map((s) => {
        const opportunities = list.filter((c) =>
          hasOpportunity(c.levels, s.key),
        ).length;
        return {
          skill: s.key,
          tagged: tagged.has(s.key),
          opportunities,
          opportunityPct: round1((opportunities / list.length) * 100),
        };
      }),
    });
  }

  scenarios.sort(
    (a, b) =>
      b.cuts - a.cuts ||
      a.title.localeCompare(b.title) ||
      a.scenarioId - b.scenarioId,
  );
  belowFloor.sort(
    (a, b) =>
      b.cuts - a.cuts ||
      a.title.localeCompare(b.title) ||
      a.scenarioId - b.scenarioId,
  );

  const tagGaps: TagGapOut[] = [];
  for (const row of scenarios) {
    if (row.cuts < opts.gapMinCuts) continue;
    for (const cell of row.cells) {
      if (
        cell.tagged &&
        cell.opportunityPct !== null &&
        cell.opportunityPct < opts.gapMaxPct
      ) {
        tagGaps.push({
          scenarioId: row.scenarioId,
          title: row.title,
          skill: cell.skill,
          opportunityPct: cell.opportunityPct,
          cuts: row.cuts,
          sessionsPlayed: row.sessionsPlayed,
        });
      }
    }
  }
  const rubricOrder = new Map(FHS_RUBRIC.map((s, i) => [s.key, i]));
  tagGaps.sort(
    (a, b) =>
      b.sessionsPlayed - a.sessionsPlayed ||
      a.opportunityPct - b.opportunityPct ||
      a.title.localeCompare(b.title) ||
      a.scenarioId - b.scenarioId ||
      (rubricOrder.get(a.skill) ?? 0) - (rubricOrder.get(b.skill) ?? 0),
  );

  return {
    scoredCuts: cuts.length,
    singleScenarioCuts,
    singleScenarioShare:
      cuts.length >= opts.floor
        ? round1((singleScenarioCuts / cuts.length) * 100)
        : null,
    scenarios,
    belowFloor,
    tagGaps,
  };
}

/* -------------------------------------------------------------------------- */
/* Same-scenario repeat improvement (EFF-33)                                  */
/* -------------------------------------------------------------------------- */

/**
 * SQL predicate dropping the "unresolved" session score: a 0 that ally-ai-learn
 * sends when it could not resolve a score, recognisable because no event was
 * ever detected in the session (`scenario_session_events` has no row for it).
 * A 0 WITH detected events is a real score — events that cancelled out — and
 * stays. Parameter-free, like `countableSessionPredicate`; `alias` is the
 * scenario_sessions alias. The subquery alias `rse` cannot collide with the
 * test-tenant helpers' `tt`/`tts`/`ttu`/`st*`.
 */
export function resolvedSessionScorePredicate(alias = 's'): string {
  return (
    `NOT (${alias}.score = 0 AND NOT EXISTS (` +
    `SELECT 1 FROM scenario_session_events rse ` +
    `WHERE rse."scenarioSessionId" = ${alias}.id))`
  );
}

/**
 * One learner's plays of one scenario version: how many, and the first and
 * latest score (by session start). Only groups with 2+ eligible plays arrive.
 */
export interface RepeatGroupRow {
  userId: number;
  scenarioId: number;
  title: string | null;
  /** scenario_sessions.scenarioVersionId; null for sessions that recorded none. */
  versionId: string | null;
  versionNumber: number | null;
  plays: number;
  firstScore: number;
  firstAt: Date;
  latestScore: number;
  latestAt: Date;
}

export interface RepeatScenarioOut {
  scenarioId: number;
  title: string;
  versionId: string | null;
  versionNumber: number | null;
  /** Learners with 2+ eligible plays of this version, whatever the span. */
  repeaters: number;
  /** Of those, learners whose first and latest play are at least a day apart. */
  pairs: number;
  firstAvg: number | null;
  latestAvg: number | null;
  change: number | null;
  changeCi: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  detectable: boolean;
  /**
   * When the scenario's scoring config (its event mappings, behaviour
   * instructions, or any PASSIVE event) was last edited; null when unknown.
   * Versions do not pin scoring — studio edits change the live rows in place.
   */
  scoringChangedAt: string | null;
  /** Of `pairs`, those whose first play predates that edit and latest play follows it. */
  pairsSpanningScoringChange: number;
}

export interface RepeatPooledOut {
  pairs: number;
  learners: number;
  up: number;
  down: number;
  tied: number;
  improvingPct: number | null;
  signP: number | null;
}

export interface RepeatSelectedLearnerOut {
  learnerId: number;
  first: number;
  latest: number;
  change: number;
  firstAt: string;
  latestAt: string;
  plays: number;
}

export interface RepeatSelectedOut {
  scenarioId: number;
  title: string | null;
  versionId: string | null;
  versionNumber: number | null;
  repeaters: number;
  pairs: number;
  learners: RepeatSelectedLearnerOut[] | null;
}

export interface RepeatImprovementOut {
  /** Learner × scenario-version groups with 2+ eligible plays, whatever the span. */
  repeatGroups: number;
  scenarios: RepeatScenarioOut[];
  pooled: RepeatPooledOut;
  selected: RepeatSelectedOut | null;
  picker: {
    scenarioId: number;
    title: string;
    versionId: string | null;
    pairs: number;
  }[];
}

const versionKey = (g: Pick<RepeatGroupRow, 'scenarioId' | 'versionId'>) =>
  `${g.scenarioId}|${g.versionId ?? ''}`;

/** True when first and latest are far enough apart to be a replay, not a retry. */
export function isRepeatPair(
  group: Pick<RepeatGroupRow, 'plays' | 'firstAt' | 'latestAt'>,
  minSpanMs = REPEAT_MIN_SPAN_MS,
): boolean {
  return (
    group.plays >= 2 &&
    group.latestAt.getTime() - group.firstAt.getTime() >= minSpanMs
  );
}

/**
 * Pairs each learner's first and latest score on the same scenario VERSION and
 * reads the change three ways:
 *
 *  - **per scenario version**, in raw points (meaningful only within it), with
 *    the paired bootstrap CI and sign test, withheld below `floor` pairs;
 *  - **pooled**, scale-free: raw points are not comparable across scenarios,
 *    so each learner is ONE vote — the sign of the mean of their per-pair signs
 *    (up on most of their scenarios = up) — and the summary is the share of
 *    non-tied learners who went up, with a sign test;
 *  - **one selected scenario** as a slope per learner, for the scenario's
 *    version with the most pairs; `null` learners below the floor.
 */
export function buildRepeatImprovement(
  groups: readonly RepeatGroupRow[],
  opts: {
    floor: number;
    scenarioId?: number;
    minSpanMs?: number;
    pickerSize?: number;
  },
): RepeatImprovementOut {
  const minSpanMs = opts.minSpanMs ?? REPEAT_MIN_SPAN_MS;
  const pickerSize = opts.pickerSize ?? REPEAT_PICKER_SIZE;
  const eligible = groups.filter((g) => g.plays >= 2);

  const byVersion = new Map<string, RepeatGroupRow[]>();
  for (const g of eligible) {
    const key = versionKey(g);
    const list = byVersion.get(key);
    if (list) list.push(g);
    else byVersion.set(key, [g]);
  }

  const pairsByVersion = new Map<string, RepeatGroupRow[]>();
  const scenarios: RepeatScenarioOut[] = [];
  for (const [key, list] of byVersion) {
    const pairs = list
      .filter((g) => isRepeatPair(g, minSpanMs))
      .sort((a, b) => a.userId - b.userId);
    pairsByVersion.set(key, pairs);
    const c = flooredPairedComparison(
      pairs.map((p) => p.firstScore),
      pairs.map((p) => p.latestScore),
      opts.floor,
    );
    scenarios.push({
      scenarioId: list[0].scenarioId,
      title: list[0].title || UNTITLED_SCENARIO,
      versionId: list[0].versionId,
      versionNumber: list[0].versionNumber,
      repeaters: list.length,
      pairs: pairs.length,
      firstAvg: c.beforeAvg,
      latestAvg: c.afterAvg,
      change: c.change,
      changeCi: c.changeCi,
      up: c.up,
      down: c.down,
      tied: c.tied,
      signP: c.signP,
      detectable: c.detectable,
      scoringChangedAt: null,
      pairsSpanningScoringChange: 0,
    });
  }
  scenarios.sort(
    (a, b) =>
      b.pairs - a.pairs ||
      b.repeaters - a.repeaters ||
      a.title.localeCompare(b.title) ||
      a.scenarioId - b.scenarioId ||
      (b.versionNumber ?? -1) - (a.versionNumber ?? -1),
  );

  // ── Pooled, one vote per learner ─────────────────────────────────────────
  const signsByLearner = new Map<number, number[]>();
  let totalPairs = 0;
  for (const pairs of pairsByVersion.values()) {
    for (const p of pairs) {
      totalPairs += 1;
      const d = p.latestScore - p.firstScore;
      const sign = d > 1e-9 ? 1 : d < -1e-9 ? -1 : 0;
      const list = signsByLearner.get(p.userId);
      if (list) list.push(sign);
      else signsByLearner.set(p.userId, [sign]);
    }
  }
  let up = 0;
  let down = 0;
  let tied = 0;
  for (const signs of signsByLearner.values()) {
    const m = signs.reduce((a, b) => a + b, 0) / signs.length;
    if (m > 0) up += 1;
    else if (m < 0) down += 1;
    else tied += 1;
  }
  const learners = signsByLearner.size;
  const enough = learners >= opts.floor;
  const sp = signTestP(up, down);
  const pooled: RepeatPooledOut = {
    pairs: totalPairs,
    learners,
    up,
    down,
    tied,
    improvingPct:
      enough && up + down > 0 ? round1((up / (up + down)) * 100) : null,
    signP: enough && sp !== null ? Math.round(sp * 10000) / 10000 : null,
  };

  // ── Picker: each scenario's best version, most pairs first ───────────────
  const bestByScenario = new Map<number, RepeatScenarioOut>();
  for (const row of scenarios) {
    // `scenarios` is already sorted best-first, so the first seen wins.
    if (!bestByScenario.has(row.scenarioId)) {
      bestByScenario.set(row.scenarioId, row);
    }
  }
  const picker = [...bestByScenario.values()]
    .filter((r) => r.pairs > 0)
    .slice(0, pickerSize)
    .map((r) => ({
      scenarioId: r.scenarioId,
      title: r.title,
      versionId: r.versionId,
      pairs: r.pairs,
    }));

  // ── Selected scenario (slope chart) ──────────────────────────────────────
  const targetId = opts.scenarioId ?? picker[0]?.scenarioId;
  let selected: RepeatSelectedOut | null = null;
  if (targetId !== undefined) {
    const best = bestByScenario.get(targetId);
    if (!best) {
      selected = {
        scenarioId: targetId,
        title: null,
        versionId: null,
        versionNumber: null,
        repeaters: 0,
        pairs: 0,
        learners: null,
      };
    } else {
      const pairs = pairsByVersion.get(versionKey(best)) ?? [];
      selected = {
        scenarioId: best.scenarioId,
        title: best.title,
        versionId: best.versionId,
        versionNumber: best.versionNumber,
        repeaters: best.repeaters,
        pairs: best.pairs,
        learners:
          pairs.length >= opts.floor
            ? pairs
                .map((p) => ({
                  learnerId: p.userId,
                  first: p.firstScore,
                  latest: p.latestScore,
                  change:
                    Math.round((p.latestScore - p.firstScore) * 100) / 100,
                  firstAt: p.firstAt.toISOString(),
                  latestAt: p.latestAt.toISOString(),
                  plays: p.plays,
                }))
                // Sorted by own change, never by level (no leaderboards).
                .sort(
                  (a, b) => b.change - a.change || a.learnerId - b.learnerId,
                )
            : null,
      };
    }
  }

  return {
    repeatGroups: eligible.length,
    scenarios,
    pooled,
    selected,
    picker,
  };
}

/**
 * Says, per scenario version, how many of its pairs straddle the scenario's
 * last scoring-config edit. A scenario version does NOT pin its scoring (the
 * event mappings and behaviour instructions are edited in place), so a pair
 * whose first play came before an edit and whose latest came after it may be
 * comparing two scoring configs. Only the LATEST edit is knowable, so a pair
 * wholly before it may still span an earlier one — the count is a floor.
 */
export function annotateScoringChanges(
  scenarios: readonly RepeatScenarioOut[],
  groups: readonly RepeatGroupRow[],
  changedAt: ReadonlyMap<number, Date | null>,
  minSpanMs = REPEAT_MIN_SPAN_MS,
): RepeatScenarioOut[] {
  const spanning = new Map<string, number>();
  for (const g of groups) {
    if (!isRepeatPair(g, minSpanMs)) continue;
    const at = changedAt.get(g.scenarioId);
    if (!at) continue;
    const t = at.getTime();
    if (g.firstAt.getTime() < t && g.latestAt.getTime() >= t) {
      const key = versionKey(g);
      spanning.set(key, (spanning.get(key) ?? 0) + 1);
    }
  }
  return scenarios.map((row) => {
    const at = changedAt.get(row.scenarioId) ?? null;
    return {
      ...row,
      scoringChangedAt: at ? at.toISOString() : null,
      pairsSpanningScoringChange: spanning.get(versionKey(row)) ?? 0,
    };
  });
}
