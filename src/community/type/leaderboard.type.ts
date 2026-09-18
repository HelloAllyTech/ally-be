import { UserStatus } from 'src/user/constants/user-status.constants';
import { LeaderboardEntryDto } from '../dto/leaderboard.dto';

// ENUMS
export enum LeaderboardView {
  LAST_WEEK = 'LAST_WEEK',
  LAST_MONTH = 'LAST_MONTH',
  LAST_YEAR = 'LAST_YEAR',
  ALL_TIME = 'ALL_TIME',
}

export enum LeaderboardSortBy {
  SCORE = 'score',
  MINUTES_PLAYED = 'minutesPlayed',
  RANK = 'rank',
}

// INTERFACES
export interface LeaderboardResult {
  data: LeaderboardEntryDto[];
  totalCount: number;
}

export interface UserRankResult {
  userId: number;
  name: string;
  profileImageUrl?: string;
  status: UserStatus;
  rank?: number;
  minutesPlayed: number;
  badgeCount: number;
  /** Days this ISO week on which the learner earned XP, of any kind. */
  daysActiveThisWeek: number;
  /** Active days needed this week for the consistency bonus. */
  weeklyGoalDays: number;
  weeklyGoalMet: boolean;
  /** @deprecated Carries daysActiveThisWeek for released clients. */
  currentStreak: number;
}
