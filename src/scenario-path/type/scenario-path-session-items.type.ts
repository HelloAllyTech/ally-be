import { SortOrder } from './scenario-paths.type';

export interface ScenarioPathSessionFilterOptions {
  limit?: number;
  offset?: number;
  sortBy?: ScenarioPathSessionSortBy;
  order?: SortOrder;
}

export enum ScenarioPathSessionSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}
