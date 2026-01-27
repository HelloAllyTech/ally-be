export enum ScenarioSessionLeaderboardEvent {
  SCENARIO_SESSION_ENDED = 'SCENARIO_SESSION_ENDED',
}

export interface ScenarioSessionLeaderboardEndedEventParams {
  userId: number;
  tenantId: string;
  date: Date;
  durationMinutes: number;
}
