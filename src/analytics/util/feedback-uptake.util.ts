import { FHS_RUBRIC } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FeedbackUptakeArmDto,
  FeedbackUptakeDifferenceDto,
  FeedbackUptakePooledDto,
  FeedbackUptakeSkillDto,
} from '../dto/feedback-uptake-analytics.dto';
import { flooredPairedComparison } from './paired-stats.util';

/**
 * Pure logic for GET /v1/analytics/foundational-skills/feedback-uptake
 * (EFF-40): pairing each debriefed session with the learner's cuts either
 * side, splitting skills into named and unnamed, collapsing per learner, and
 * applying the floors. No database, so every rule is tested on fixtures.
 */

/** A session whose debrief was mapped, with the distinct skills it named. */
export interface UptakeSession {
  sessionId: string;
  userId: number;
  endedAt: Date;
  /** Distinct rubric keys the debrief's improvements were filed under (nulls dropped). */
  namedSkills: string[];
}

/** One scored cut of a learner. */
export interface UptakeCut {
  userId: number;
  cutIndex: number;
  /** When the session that closed the cut ended: every word in it is from on or before this. */
  closedAt: Date;
  /** When the cut's FIRST session ended; null when that session cannot be found. */
  firstEndedAt: Date | null;
  /** Only skills the cut gave an opportunity for. */
  levels: Record<string, number>;
}

export type UptakeOutcome = 'rose' | 'held' | 'fell';
export type UptakeRole = 'named' | 'unnamed';

export interface UptakeSides {
  before: UptakeCut | null;
  after: UptakeCut | null;
}

/**
 * The pairing rule, in one place so no client can apply it differently.
 *
 * - **Before**: the learner's last cut that closed AT OR BEFORE the session
 *   ended. Its every word predates the debrief, which is written after the
 *   session ends — so the cut that closed in this very session counts.
 * - **After**: the first cut whose first session ended strictly AFTER the
 *   session did: every session in it followed the debrief. A cut carrying the
 *   tail of this session (first session = this one) is not after.
 *
 * A cut that straddles the session is on neither side, exactly as course
 * impact treats a cut that straddles a course. `cuts` must be one learner's,
 * oldest first.
 */
export function sessionSides(
  endedAt: Date,
  cuts: readonly UptakeCut[],
): UptakeSides {
  const t = endedAt.getTime();
  let before: UptakeCut | null = null;
  for (const cut of cuts) {
    if (cut.closedAt.getTime() <= t) before = cut;
  }
  const after =
    cuts.find(
      (cut) => cut.firstEndedAt !== null && cut.firstEndedAt.getTime() > t,
    ) ?? null;
  return { before, after };
}

const hasLevel = (levels: Record<string, number>, skill: string): boolean =>
  Object.prototype.hasOwnProperty.call(levels, skill) &&
  Number.isFinite(Number(levels[skill]));

/** One (window, skill) observation. */
export interface UptakeObservation {
  userId: number;
  skill: string;
  role: UptakeRole;
  outcome: UptakeOutcome;
  beforeLevel: number;
}

export interface UptakeWindows {
  observations: UptakeObservation[];
  sessionsPaired: number;
  windows: number;
  learnersPaired: number;
  namedNotAssessable: number;
}

/**
 * Turn mapped sessions into observations.
 *
 * Sessions of one learner that share the same before and after cut are ONE
 * window: the same two cuts must not be counted once per session, and a skill
 * one session named cannot be "unnamed" for its neighbour in the same window.
 * So a skill is named in a window when ANY of its debriefs named it.
 */
export function buildObservations(
  sessions: readonly UptakeSession[],
  cutsByUser: ReadonlyMap<number, readonly UptakeCut[]>,
): UptakeWindows {
  const windows = new Map<
    string,
    { userId: number; before: UptakeCut; after: UptakeCut; named: Set<string> }
  >();
  let sessionsPaired = 0;
  for (const session of sessions) {
    const { before, after } = sessionSides(
      session.endedAt,
      cutsByUser.get(session.userId) ?? [],
    );
    if (!before || !after) continue;
    sessionsPaired += 1;
    const key = `${session.userId}:${before.cutIndex}:${after.cutIndex}`;
    const window = windows.get(key) ?? {
      userId: session.userId,
      before,
      after,
      named: new Set<string>(),
    };
    for (const skill of session.namedSkills) window.named.add(skill);
    windows.set(key, window);
  }

  const observations: UptakeObservation[] = [];
  let namedNotAssessable = 0;
  for (const window of windows.values()) {
    for (const { key: skill } of FHS_RUBRIC) {
      const named = window.named.has(skill);
      if (
        !hasLevel(window.before.levels, skill) ||
        !hasLevel(window.after.levels, skill)
      ) {
        if (named) namedNotAssessable += 1;
        continue;
      }
      const b = Number(window.before.levels[skill]);
      const a = Number(window.after.levels[skill]);
      observations.push({
        userId: window.userId,
        skill,
        role: named ? 'named' : 'unnamed',
        outcome: a > b ? 'rose' : a < b ? 'fell' : 'held',
        beforeLevel: b,
      });
    }
  }

  return {
    observations,
    sessionsPaired,
    windows: windows.size,
    learnersPaired: new Set([...windows.values()].map((w) => w.userId)).size,
    namedNotAssessable,
  };
}

/** One learner's collapsed shares in one role (0–1), with their n. */
export interface LearnerShares {
  userId: number;
  n: number;
  rose: number;
  held: number;
  fell: number;
  beforeLevel: number;
}

/**
 * Collapse observations to ONE value per learner: their share of rose / held /
 * fell and their mean before level. The bootstrap then runs over people, not
 * over rows, so a learner with forty windows weighs what a learner with two does.
 */
export function collapsePerLearner(
  observations: readonly UptakeObservation[],
): Map<number, LearnerShares> {
  const acc = new Map<
    number,
    { n: number; rose: number; held: number; fell: number; before: number }
  >();
  for (const o of observations) {
    const row = acc.get(o.userId) ?? {
      n: 0,
      rose: 0,
      held: 0,
      fell: 0,
      before: 0,
    };
    row.n += 1;
    row[o.outcome] += 1;
    row.before += o.beforeLevel;
    acc.set(o.userId, row);
  }
  const out = new Map<number, LearnerShares>();
  for (const [userId, r] of acc) {
    out.set(userId, {
      userId,
      n: r.n,
      rose: r.rose / r.n,
      held: r.held / r.n,
      fell: r.fell / r.n,
      beforeLevel: r.before / r.n,
    });
  }
  return out;
}

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
const pct1 = (share: number): number => Math.round(share * 1000) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** A role's shares over learners, floored. */
export function armOf(
  learners: ReadonlyMap<number, LearnerShares>,
  observations: number,
  floor: number,
): FeedbackUptakeArmDto {
  const rows = [...learners.values()];
  const enough = rows.length >= floor && rows.length > 0;
  return {
    learners: rows.length,
    observations,
    rosePct: enough ? pct1(mean(rows.map((r) => r.rose))) : null,
    heldPct: enough ? pct1(mean(rows.map((r) => r.held))) : null,
    fellPct: enough ? pct1(mean(rows.map((r) => r.fell))) : null,
    beforeLevelAvg: enough
      ? round2(mean(rows.map((r) => r.beforeLevel)))
      : null,
  };
}

/**
 * Named − unnamed "rose" share, within learner, over learners with both —
 * the paired helper with unnamed as "before" and named as "after", so
 * `change` is named − unnamed in percentage points.
 */
export function differenceOf(
  named: ReadonlyMap<number, LearnerShares>,
  unnamed: ReadonlyMap<number, LearnerShares>,
  floor: number,
): FeedbackUptakeDifferenceDto {
  const both = [...named.keys()]
    .filter((userId) => unnamed.has(userId))
    .sort((a, b) => a - b);
  const c = flooredPairedComparison(
    both.map((u) => (unnamed.get(u) as LearnerShares).rose * 100),
    both.map((u) => (named.get(u) as LearnerShares).rose * 100),
    floor,
  );
  return {
    learners: c.n,
    namedRosePct: c.afterAvg,
    unnamedRosePct: c.beforeAvg,
    change: c.change,
    changeCi: c.changeCi,
    up: c.up,
    down: c.down,
    tied: c.tied,
    signP: c.signP,
    detectable: c.detectable,
  };
}

function rowFor(
  observations: readonly UptakeObservation[],
  floor: number,
): Pick<FeedbackUptakePooledDto, 'named' | 'unnamed' | 'difference'> {
  const named = observations.filter((o) => o.role === 'named');
  const unnamed = observations.filter((o) => o.role === 'unnamed');
  const namedLearners = collapsePerLearner(named);
  const unnamedLearners = collapsePerLearner(unnamed);
  return {
    named: armOf(namedLearners, named.length, floor),
    unnamed: armOf(unnamedLearners, unnamed.length, floor),
    difference: differenceOf(namedLearners, unnamedLearners, floor),
  };
}

export interface FeedbackUptakeBuild {
  pooled: FeedbackUptakePooledDto;
  skills: FeedbackUptakeSkillDto[];
  sessionsPaired: number;
  windows: number;
  learnersPaired: number;
  namedNotAssessable: number;
}

/**
 * The whole read: observations, then the pooled row and one row per rubric
 * skill (all 14, rubric order). `cutsByUser` values must be oldest first.
 */
export function buildFeedbackUptake(
  sessions: readonly UptakeSession[],
  cutsByUser: ReadonlyMap<number, readonly UptakeCut[]>,
  floor: number,
): FeedbackUptakeBuild {
  const built = buildObservations(sessions, cutsByUser);
  const skills = FHS_RUBRIC.map((skill) => ({
    skill: skill.key,
    name: skill.name,
    tier: skill.tier,
    ...rowFor(
      built.observations.filter((o) => o.skill === skill.key),
      floor,
    ),
  }));
  return {
    pooled: rowFor(built.observations, floor),
    skills,
    sessionsPaired: built.sessionsPaired,
    windows: built.windows,
    learnersPaired: built.learnersPaired,
    namedNotAssessable: built.namedNotAssessable,
  };
}
