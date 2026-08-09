// ENUMS
export enum PracticeStreakGroupBy {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

// INTERFACES
export interface PracticeStreakCell {
  /** Start date of the bucket (YYYY-MM-DD). For DAY this is the day itself. */
  periodStart: string;
  /** End date of the bucket (YYYY-MM-DD), inclusive. */
  periodEnd: string;
  /** Practice minutes accumulated in the bucket. */
  minutes: number;
}

export interface PracticeStreakResult {
  cells: PracticeStreakCell[];
  totalMinutes: number;
  currentStreak: number;
  longestStreak: number;
}

/**
 * One user's consecutive-active-days statistics, as returned by
 * UserDailyScoreRepository.getStreakStatsForUsers. All dates are YYYY-MM-DD in
 * the business timezone.
 */
export interface StreakStatsRow {
  userId: number;
  /** Length of the run that is still alive (ends today or yesterday); 0 if none. */
  currentStreak: number;
  /** Longest run on record. */
  longestStreak: number;
  /** First day of the current run; null when there is no current run. */
  streakStartDate: string | null;
  /** Most recent active day ever; null when the user has never been active. */
  lastActiveDate: string | null;
  /**
   * Length of the most recent run that is NOT the current one — the number to
   * show as "your best recent run" when a streak has just been lost.
   */
  previousRunLength: number | null;
  /** Last day of that previous run. */
  previousRunEndedOn: string | null;
}
