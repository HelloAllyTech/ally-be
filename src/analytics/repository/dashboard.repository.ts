import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Dashboard } from '../entity/dashboard.entity';
import { CreateDashboardDto } from '../dto/analytics.dto';

@Injectable()
export class DashboardRepository extends Repository<Dashboard> {
  constructor(private dataSource: DataSource) {
    super(Dashboard, dataSource.createEntityManager());
  }

  async findByExternalIdAndTenantId(
    externalId: string,
    tenantId: string,
  ): Promise<Dashboard | null> {
    return this.findOne({
      where: {
        externalId,
        tenantId,
      },
    });
  }

  async findByExternalIdTenantIdAndGroupId(
    externalId: string,
    tenantId: string,
    groupId: string,
  ): Promise<Dashboard | null> {
    return this.findOne({
      where: {
        externalId,
        tenantId,
        groupId,
      },
    });
  }

  async findByGroupIdsAndTenantId(
    groupIds: number[],
    tenantId: string,
  ): Promise<Dashboard[]> {
    return this.find({
      where: {
        groupId: In(groupIds),
        tenantId,
      },
    });
  }

  async createOrUpdateDashboard(
    dashboard: CreateDashboardDto,
    em?: EntityManager,
  ): Promise<Dashboard> {
    const repo = em
      ? em.getRepository(Dashboard)
      : this.dataSource.getRepository(Dashboard);

    const existingDashboard = await repo.findOne({
      where: {
        externalId: dashboard.externalId,
        tenantId: dashboard.tenantId,
        groupId: dashboard.groupId,
      },
    });

    if (existingDashboard) {
      await repo.update({ id: existingDashboard.id }, dashboard);
      return { ...existingDashboard, ...dashboard };
    }

    const dashboardEntity = repo.create(dashboard);
    return repo.save(dashboardEntity);
  }

  async updateDashboard(
    id: number,
    data: Partial<Dashboard>,
    em?: EntityManager,
  ): Promise<boolean> {
    const repo = em
      ? em.getRepository(Dashboard)
      : this.dataSource.getRepository(Dashboard);

    const result = await repo.update({ id }, data);
    return result.affected !== 0;
  }

  async deleteDashboard(
    id: number,
    tenantId: string,
    em?: EntityManager,
  ): Promise<boolean> {
    const repo = em
      ? em.getRepository(Dashboard)
      : this.dataSource.getRepository(Dashboard);

    const result = await repo.delete({ id, tenantId });
    return result.affected !== 0;
  }
}
