export enum ScenarioPathStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export interface ScenarioPathFilterOptions {
  status?: ScenarioPathStatus;
  limit?: number;
  offset?: number;
  search?: string;
}
