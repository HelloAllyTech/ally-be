import { ScenarioPathSession } from '../entity/scenario-path-session.entity';
import { ScenarioPath } from '../entity/scenario-path.entity';

export enum ScenarioPathStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export interface ScenarioPathFilterOptions {
  status?: string[];
  limit?: number;
  offset?: number;
  search?: string;
  tenantId?: string;
  sortBy?: ScenarioPathSortBy;
  order?: SortOrder;
}

export interface ScenarioPathWithSession extends ScenarioPath {
  session: ScenarioPathSession;
}

export interface ScenarioPathWithSessionFilterOptions {
  userId: number;
  tenantId: string;
  limit?: number;
  offset?: number;
  sortBy?: ScenarioPathSortBy;
  order?: SortOrder;
}
export interface ScenarioPathsWithSession {
  data: ScenarioPathWithSession[];
  count: number;
}

export interface MinimalScenarioPathData {
  id: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  status: ScenarioPathStatus;
}

export enum ScenarioPathSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}
