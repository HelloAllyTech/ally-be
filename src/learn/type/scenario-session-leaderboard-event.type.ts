import { UserDailyScores } from 'src/community/entity/user-daily-scores.entity';

export enum ScenarioSessionLeaderboardEvent {
  SCENARIO_SESSION_ENDED = 'SCENARIO_SESSION_ENDED',
}

export interface ScenarioSessionLeaderboardEndedEventParams {
  userId: number;
  tenantId: string;
  date: Date;
  durationMinutes: number;
}

export enum LeaderboardActionEvent {
  MINUTES_PLAYED_UPDATED = 'MINUTES_PLAYED_UPDATED',
}

export interface MinutesPlayedUpdatedEventParams {
  userId: number;
  userDateEntryBeforeUpdation?: UserDailyScores;
}
