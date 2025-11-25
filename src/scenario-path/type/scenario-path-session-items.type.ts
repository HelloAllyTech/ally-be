export enum SessionItemStatus {
  LOCKED = 'LOCKED',
  UNLOCKED = 'UNLOCKED',
  COMPLETED = 'COMPLETED',
}

export interface ScenarioPathSessionFilterOptions {
  limit?: number;
  offset?: number;
}
