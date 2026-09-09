import { TrackItemType } from 'src/track/type/track.type';

/**
 * XP rules and the level ladder.
 *
 * XP pays for **effort the learner controls** — showing up, staying, coming back, and
 * the work around the roleplay. It deliberately does not pay for a session's score:
 * that number is an unbounded sum of whatever the author attached (a flat +/-10 per
 * behaviour instruction, plus arbitrary per-event scores with no count limit), so two
 * sims can differ more than tenfold in what a perfect run is worth. Paying against it
 * would launder authoring choices into rewards.
 *
 * The ladder is written out rather than computed so that a change to the curve is a
 * reviewable diff and never drifts with floating point. It was generated from
 * delta(n) = round(100 * 1.6^(n-2)), which advances quickly at first and then demands
 * exponentially more practice per level.
 */

export const XP_RULE = {
  PRACTICE_MINUTE: 'PRACTICE_MINUTE',
  SESSION_COMPLETED: 'SESSION_COMPLETED',
  DAILY_DEPTH_MILESTONE: 'DAILY_DEPTH_MILESTONE',
  TRACK_ITEM_COMPLETED: 'TRACK_ITEM_COMPLETED',
  DEBRIEF_THREAD: 'DEBRIEF_THREAD',
  PEER_COMMENT: 'PEER_COMMENT',
  WEEKLY_CONSISTENCY: 'WEEKLY_CONSISTENCY',

  /**
   * Retired in XP v2. Never written again — weekly consistency replaced it, and the two
   * together would compound inside the daily caps. The name stays because `rule` is
   * plain text and historical rows have to keep reading back.
   */
  STREAK_MULTIPLIER: 'STREAK_MULTIPLIER',
  /**
   * Retired in XP v2. It never had a production caller in the first place, and it was
   * outcome-based, which is what this model moved away from. Kept for the same reason.
   */
  SKILL_PERSONAL_BEST: 'SKILL_PERSONAL_BEST',
} as const;

export type XpRule = (typeof XP_RULE)[keyof typeof XP_RULE];

/** Rules that are still written. Anything outside this set is history only. */
export const ACTIVE_XP_RULES: readonly string[] = [
  XP_RULE.PRACTICE_MINUTE,
  XP_RULE.SESSION_COMPLETED,
  XP_RULE.DAILY_DEPTH_MILESTONE,
  XP_RULE.TRACK_ITEM_COMPLETED,
  XP_RULE.DEBRIEF_THREAD,
  XP_RULE.PEER_COMMENT,
  XP_RULE.WEEKLY_CONSISTENCY,
];

export const XP_SOURCE_TYPE = {
  SCENARIO_SESSION: 'scenario_session',
  TRACK_ITEM: 'track_item',
  DEBRIEF: 'debrief',
  PEER_COMMENT: 'peer_comment',
  /** Synthetic: sourceId is `YYYY-MM-DD` or `YYYY-MM-DD:<threshold>`. */
  DAY: 'day',
  /** Synthetic: sourceId is an ISO week key, `2026-W37`. */
  WEEK: 'week',
  BACKFILL: 'backfill',
} as const;

export type XpSourceType = (typeof XP_SOURCE_TYPE)[keyof typeof XP_SOURCE_TYPE];

export const XP_AWARD = {
  PER_PRACTICE_MINUTE: 1,
  PER_SESSION_COMPLETED: 10,
  PER_DEBRIEF_THREAD: 15,
  PER_PEER_COMMENT: 5,
  WEEKLY_CONSISTENCY: 100,
};

/**
 * XP per completed track item, by component type.
 *
 * Graded work that takes real thought pays most; passive consumption pays least. The
 * weights are the signal to a learner about which components matter, so they are meant
 * to be legible rather than finely tuned.
 *
 * ROLEPLAY is zero on purpose. A roleplay item is already paid for by the practice
 * minutes and completion award its own session earns — before XP v2 it collected a flat
 * 25 on top of those, which double-paid roleplay against every other component type.
 */
export const TRACK_ITEM_XP: Readonly<Record<TrackItemType, number>> = {
  [TrackItemType.QUIZ]: 30,
  [TrackItemType.ANNOTATED_ARTIFACT]: 30,
  [TrackItemType.JOURNAL]: 25,
  [TrackItemType.CASE]: 25,
  [TrackItemType.VIDEO]: 10,
  [TrackItemType.ARTICLE]: 10,
  [TrackItemType.GAME]: 5,
  [TrackItemType.ROLEPLAY]: 0,
};

/**
 * Bonuses for reaching a depth of practice within one business day.
 *
 * Ascending, and each fires at most once a day — a learner who reaches 60 minutes
 * collects all three. Idempotency keys on `YYYY-MM-DD:<minutes>`, so a redelivered
 * session cannot pay the same milestone twice.
 */
export const DAILY_DEPTH_MILESTONES: readonly {
  minutes: number;
  xp: number;
}[] = [
  { minutes: 15, xp: 10 },
  { minutes: 30, xp: 20 },
  { minutes: 60, xp: 40 },
];

/**
 * Guards so no single dimension can be farmed.
 *
 * A session shorter than MIN_SESSION_SECONDS_FOR_XP earns nothing, and one that fails
 * the engagement gate earns nothing either — elapsed duration alone would pay an idle
 * open session the same as a live one. True engaged-seconds are not available (the turn
 * metrics table is latency instrumentation, not talk time), so learner turn count is
 * the honest proxy: a real conversation has turns in it, an abandoned tab does not.
 */
export const MIN_SESSION_SECONDS_FOR_XP = 60;
export const MIN_LEARNER_TURNS_FOR_XP = 4;
export const MIN_LEARNER_TURNS_PER_MINUTE = 0.5;

/**
 * Most minutes any one session can bank. Depth across a day has to come from more
 * sessions rather than one session left running.
 */
export const PER_SESSION_MINUTE_CEILING = 45;

/**
 * Per-source daily caps, so no single source can be ground out.
 *
 * Each entry bounds the rules it names, independently of the others. The caps sum to
 * more than DAILY_XP_CEILING on purpose: a learner cannot bank every source in a day,
 * so the ceiling forces a choice about which work to do while the per-source caps stop
 * any one of them carrying the whole day.
 */
export const DAILY_SOURCE_CAPS: readonly {
  name: string;
  rules: readonly string[];
  cap: number;
}[] = [
  { name: 'practice', rules: [XP_RULE.PRACTICE_MINUTE], cap: 150 },
  { name: 'sessions', rules: [XP_RULE.SESSION_COMPLETED], cap: 50 },
  { name: 'depth', rules: [XP_RULE.DAILY_DEPTH_MILESTONE], cap: 70 },
  { name: 'components', rules: [XP_RULE.TRACK_ITEM_COMPLETED], cap: 100 },
  { name: 'debrief', rules: [XP_RULE.DEBRIEF_THREAD], cap: 45 },
  { name: 'peer', rules: [XP_RULE.PEER_COMMENT], cap: 15 },
];

/**
 * Ceiling on everything earned in one business day.
 *
 * Weekly consistency sits outside it: it is paid once a week for a pattern of showing
 * up rather than for anything done on the day it lands, and letting a full day silently
 * swallow it would make the reward arrive at random.
 */
export const DAILY_XP_CEILING = 250;
export const UNCAPPED_RULES: readonly string[] = [XP_RULE.WEEKLY_CONSISTENCY];

/** Distinct days in an ISO week that must earn XP for the consistency bonus. */
export const WEEKLY_CONSISTENCY_DAYS = 4;

/**
 * Rules that do not make a day count toward weekly consistency.
 *
 * Without this the rule feeds itself: a day qualifies by earning XP, and qualifying
 * pays XP. Bonus rules are excluded from the qualifying count so only work a learner
 * actually did on that day can advance them toward the bonus.
 */
export const NON_QUALIFYING_RULES: readonly string[] = [
  XP_RULE.WEEKLY_CONSISTENCY,
  XP_RULE.DAILY_DEPTH_MILESTONE,
];

/**
 * What makes a comment on a peer's session worth XP.
 *
 * Comments are the softest signal in the model — cheap to produce and hard to judge —
 * so they are bounded twice: this floor, and the peer daily cap above. The floor is
 * about excluding the reflex reply ("nice one", an emoji), not about grading insight;
 * grading it would mean an LLM marking sincerity, which is neither cheap nor fair.
 * Reactions never earn XP at all.
 */
export const PEER_COMMENT_MIN_CHARS = 40;

export const isSubstantivePeerComment = (content: string): boolean =>
  (content ?? '').trim().length >= PEER_COMMENT_MIN_CHARS;

export const MAX_LEVEL = 10;

/**
 * Cumulative XP required to have reached each level. Index 0 is level 1.
 *
 * NOT yet rescaled for v2, deliberately. v2 adds four earning sources, so totals will
 * inflate and the ladder should stretch to match — but production says the curve is
 * already mis-scaled in the other direction, and doubling it would make that worse:
 * at the time of writing 134 learners had earned 18,434 XP between them, an average
 * lifetime total of ~138, against a level-2 threshold of 100 and a level-10 threshold
 * of 11,287. Essentially the whole population sits at level 1 or 2 and the top of the
 * ladder is unreachable.
 *
 * `scripts/recompute-xp-v2.ts` prints the exact inflation ratio off real history.
 * Scale this array by that ratio only after deciding whether holding today's pacing is
 * what you actually want, because today's pacing is what produced the numbers above.
 * Whatever is chosen, change the array and the generating formula in one diff.
 */
export const LEVEL_THRESHOLDS: readonly number[] = [
  0, // level 1
  100, // level 2
  260, // level 3
  516, // level 4
  926, // level 5
  1581, // level 6
  2630, // level 7
  4308, // level 8
  6992, // level 9
  11287, // level 10
];

export interface LevelStanding {
  level: number;
  /** Cumulative XP at which the current level began. */
  levelFloorXp: number;
  /** Cumulative XP needed for the next level, or null once at MAX_LEVEL. */
  nextLevelXp: number | null;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP still needed to level up, or null once at MAX_LEVEL. */
  xpToNextLevel: number | null;
  /** 0-1 progress through the current level. 1 once at MAX_LEVEL. */
  progress: number;
  isMaxLevel: boolean;
}

/**
 * Resolves a cumulative XP total to a level and the learner's position inside it.
 * Negative or missing totals are treated as zero so a bad read can never render a
 * negative level.
 */
export function resolveLevel(totalXp: number): LevelStanding {
  const xp = Number.isFinite(totalXp) && totalXp > 0 ? Math.floor(totalXp) : 0;

  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }

  const levelFloorXp = LEVEL_THRESHOLDS[level - 1];
  const isMaxLevel = level >= MAX_LEVEL;
  const nextLevelXp = isMaxLevel ? null : LEVEL_THRESHOLDS[level];
  const xpIntoLevel = xp - levelFloorXp;
  const xpToNextLevel = nextLevelXp === null ? null : nextLevelXp - xp;

  const span = nextLevelXp === null ? 0 : nextLevelXp - levelFloorXp;
  const progress = span > 0 ? Math.min(1, xpIntoLevel / span) : 1;

  return {
    level,
    levelFloorXp,
    nextLevelXp,
    xpIntoLevel,
    xpToNextLevel,
    progress,
    isMaxLevel,
  };
}

/**
 * Whether a session counts as practised at all.
 *
 * Both halves matter. The turn floor rejects a session nobody spoke in; the rate floor
 * rejects one where a couple of turns were spread over an hour of open tab. A session
 * that fails this earns nothing — not the minutes, and not the completion award, since
 * "completing" a session nobody was present for is not an accomplishment.
 */
export function isEngagedSession(
  durationSeconds: number,
  learnerTurns: number,
): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (!Number.isFinite(learnerTurns)) return false;
  if (learnerTurns < MIN_LEARNER_TURNS_FOR_XP) return false;

  const minutes = durationSeconds / 60;
  if (minutes <= 0) return false;

  return learnerTurns / minutes >= MIN_LEARNER_TURNS_PER_MINUTE;
}

/**
 * Practice XP for one session, before the daily caps are applied.
 *
 * Minutes round down and are capped per session. A session that is too short or fails
 * the engagement gate earns nothing at all, including the completion bonus.
 */
export function practiceXpForSession(
  durationSeconds: number,
  learnerTurns: number,
): { minuteXp: number; completionXp: number } {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < MIN_SESSION_SECONDS_FOR_XP ||
    !isEngagedSession(durationSeconds, learnerTurns)
  ) {
    return { minuteXp: 0, completionXp: 0 };
  }

  const minutes = Math.min(
    Math.floor(durationSeconds / 60),
    PER_SESSION_MINUTE_CEILING,
  );

  return {
    minuteXp: minutes * XP_AWARD.PER_PRACTICE_MINUTE,
    completionXp: XP_AWARD.PER_SESSION_COMPLETED,
  };
}

/** XP for completing one track item of the given type. Unknown types earn nothing. */
export function trackItemXp(itemType: string | undefined): number {
  if (!itemType) return 0;
  return TRACK_ITEM_XP[itemType as TrackItemType] ?? 0;
}

/**
 * The depth milestones newly reached by crossing from `minutesBefore` to `minutesAfter`
 * within one day. Empty when the day did not cross one.
 */
export function depthMilestonesCrossed(
  minutesBefore: number,
  minutesAfter: number,
): { minutes: number; xp: number }[] {
  return DAILY_DEPTH_MILESTONES.filter(
    (milestone) =>
      minutesBefore < milestone.minutes && minutesAfter >= milestone.minutes,
  ).map((milestone) => ({ ...milestone }));
}

/**
 * In-process events the progress module announces.
 *
 * Declared here rather than beside the service that emits them so a listener in another
 * module can subscribe without pulling the service's whole import graph in behind it.
 */
export const PROGRESS_EVENTS = {
  XP_AWARDED: 'progress.xp.awarded',
  LEVEL_UP: 'progress.level.up',
} as const;

export interface XpAwardedEvent {
  userId: number;
  tenantId: string;
  xp: number;
  totalXp: number;
  level: number;
}

export interface LevelUpEvent {
  userId: number;
  tenantId: string;
  previousLevel: number;
  level: number;
}
