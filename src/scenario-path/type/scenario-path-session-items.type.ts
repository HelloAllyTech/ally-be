import { SortOrder } from './scenario-paths.type';

export interface ScenarioPathSessionFilterOptions {
  limit?: number;
  offset?: number;
  sortBy?: ScenarioPathSessionSortBy;
  order?: SortOrder;
  languageCode?: string;
}

export enum ScenarioPathSessionSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}
