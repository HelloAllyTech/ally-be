export enum SessionItemStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  LOCKED = 'LOCKED',
}

export interface ScenarioPathSessionFilterOptions {
  limit?: number;
  offset?: number;
}
