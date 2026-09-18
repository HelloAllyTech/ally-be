/** Notification `type` used for every reminder this evaluator sends. */
export const ENGAGEMENT_REMINDER_TYPE = 'ENGAGEMENT_REMINDER';

/**
 * Days of inactivity (no authenticated request touching `lastActiveAt`,
 * measured from `COALESCE(lastActiveAt, createdAt)`) before a learner is
 * considered disengaged and eligible for a reminder.
 */
export const INACTIVITY_DAYS_THRESHOLD = 7;

/**
 * Minimum days between reminders to the same learner, checked against their
 * own `in_app_notifications` history — this is what keeps a still-inactive
 * learner from getting nudged every single hourly tick.
 */
export const REMINDER_COOLDOWN_DAYS = 14;

export const REMINDER_TITLE = 'We miss you!';
export const REMINDER_BODY =
  "It's been a while since your last practice session. Pick up right where you left off — one roleplay is all it takes.";
