export enum SessionItemStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  LOCKED = 'LOCKED',
}
export interface Scenario {
  scenarioId: number;
  order: number;
  message?: string;
  minimumScore: number;
}
