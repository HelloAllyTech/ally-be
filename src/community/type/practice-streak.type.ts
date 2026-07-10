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
