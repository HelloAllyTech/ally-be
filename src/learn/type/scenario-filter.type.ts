import { EntityManager } from 'typeorm';
import { Scenarios } from '../entity/scenarios.entity';

export type ScenarioFilters = {
  status?: string;
  tenantId?: string;
  search?: string;
  isPublic?: boolean;
  isMultiTenantAdmin?: boolean;
  userId?: number;
  languageCode?: string;
};

export type GetScenarioByIdOptions = {
  select?: (keyof Scenarios)[];
  em?: EntityManager;
  isPublic?: boolean;
  languageCode?: string;
};
