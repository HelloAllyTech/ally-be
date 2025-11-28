import { CreateScenarioPathItemDto } from '../dto/create-scenario-path-item.dto';
import { CreateScenarioPathDto } from '../dto/create-scenario-path.dto';
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
  status: ScenarioPathStatus;
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

export type ScenarioPathItemData = CreateScenarioPathItemDto & {
  id?: string;
};

export type ScenarioPathData = Omit<CreateScenarioPathDto, 'scenarios'> & {
  id?: string;
  scenarios?: ScenarioPathItemData[];
};
