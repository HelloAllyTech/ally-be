import { Dashboard } from '../entity/dashboards.entity';

export type DashboardMetadata = {
  params?: string[];
};

export type DashboardWithGroupId = Dashboard & { groupId: number };
