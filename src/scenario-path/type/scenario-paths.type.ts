import { ScenarioPathSession } from '../entity/scenario-path-session.entity';
import { ScenarioPath } from '../entity/scenario-path.entity';

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

export interface ScenarioPathWithSession extends ScenarioPath {
  session: ScenarioPathSession;
}

export interface ScenarioPathWithSessionFilterOptions {
  userId: number;
  limit?: number;
  offset?: number;
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
