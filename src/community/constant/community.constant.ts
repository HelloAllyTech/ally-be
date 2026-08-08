// Score points for different actions in the community
export const scorePoints = {
  MINUTES_PLAYED: 1,
  REACTION: 0.25,
  COMMENT: 0.5,
  ACTIVE_DAY_BONUS: 1,
};

/**
 * Minutes of practice that make a calendar day count toward the streak.
 * This is the rule the streak actually enforces — everything user-facing must
 * agree with it rather than advertising a different number.
 */
export const ACTIVE_DAY_MINUTES = 1.0;

/**
 * Daily practice goal shown alongside the streak, when a tenant sets one via
 * `tenant.settings.practiceStreak.dailyGoalMinutes`.
 *
 * Defaults to the real threshold so the out-of-the-box copy is honest: a tenant
 * has to opt in to an aspirational goal. Never let it drop below
 * ACTIVE_DAY_MINUTES, or hitting the "goal" would fail to protect the streak.
 */
export const DEFAULT_DAILY_GOAL_MINUTES = ACTIVE_DAY_MINUTES;
