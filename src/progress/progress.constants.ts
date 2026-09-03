/**
 * XP rules and the level ladder.
 *
 * The ladder is written out rather than computed so that a change to the curve is a
 * reviewable diff and never drifts with floating point. It was generated from
 * delta(n) = round(100 * 1.6^(n-2)), which advances quickly at first and then demands
 * exponentially more practice per level.
 */

export const XP_RULE = {
  PRACTICE_MINUTE: 'PRACTICE_MINUTE',
  SESSION_COMPLETED: 'SESSION_COMPLETED',
  TRACK_ITEM_COMPLETED: 'TRACK_ITEM_COMPLETED',
  SKILL_PERSONAL_BEST: 'SKILL_PERSONAL_BEST',
  STREAK_MULTIPLIER: 'STREAK_MULTIPLIER',
} as const;

export type XpRule = (typeof XP_RULE)[keyof typeof XP_RULE];

export const XP_SOURCE_TYPE = {
  SCENARIO_SESSION: 'scenario_session',
  TRACK_ITEM: 'track_item',
  BACKFILL: 'backfill',
} as const;

export type XpSourceType = (typeof XP_SOURCE_TYPE)[keyof typeof XP_SOURCE_TYPE];

export const XP_AWARD = {
  PER_PRACTICE_MINUTE: 1,
  PER_SESSION_COMPLETED: 10,
  PER_TRACK_ITEM_COMPLETED: 25,
  PER_SKILL_PERSONAL_BEST: 50,
};

/** Applied to practice-minute XP once a learner is on day 3 or later of a live streak. */
export const STREAK_MULTIPLIER = 1.25;
export const STREAK_MULTIPLIER_MIN_DAYS = 3;

/**
 * Guards so no single dimension can be farmed. A session shorter than this earns nothing,
 * minutes always round down, and practice XP is capped per day.
 */
export const MIN_SESSION_SECONDS_FOR_XP = 60;
export const DAILY_PRACTICE_XP_CAP = 300;
export const DAILY_SKILL_PERSONAL_BEST_CAP = 1;

export const MAX_LEVEL = 10;

/** Cumulative XP required to have reached each level. Index 0 is level 1. */
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
 * Practice XP for one session, before the daily cap is applied. Sessions under
 * MIN_SESSION_SECONDS_FOR_XP earn nothing at all, including the completion bonus.
 */
export function practiceXpForSession(
  durationSeconds: number,
  streakDays: number,
): { minuteXp: number; streakBonusXp: number; completionXp: number } {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < MIN_SESSION_SECONDS_FOR_XP
  ) {
    return { minuteXp: 0, streakBonusXp: 0, completionXp: 0 };
  }

  const minutes = Math.floor(durationSeconds / 60);
  const minuteXp = minutes * XP_AWARD.PER_PRACTICE_MINUTE;

  const streakApplies = streakDays >= STREAK_MULTIPLIER_MIN_DAYS;
  const streakBonusXp = streakApplies
    ? Math.round(minuteXp * (STREAK_MULTIPLIER - 1))
    : 0;

  return {
    minuteXp,
    streakBonusXp,
    completionXp: XP_AWARD.PER_SESSION_COMPLETED,
  };
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
