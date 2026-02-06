import { Injectable } from '@nestjs/common';
import { Dashboard } from '../entity/dashboards.entity';
import { DataSource, Repository } from 'typeorm';
import { DashboardTenant } from '../entity/dashboard-tenant.entity';
import { DashboardGroup } from '../entity/dashboard-group.entity';
import { DashboardWithGroupId } from '../type/dashboard.data.type';

@Injectable()
export class DashboardRepository extends Repository<Dashboard> {
  constructor(private dataSource: DataSource) {
    super(Dashboard, dataSource.createEntityManager());
  }

  async findByExternalId(externalId: string): Promise<Dashboard | null> {
    return this.findOne({ where: { externalId } });
  }

  async findByExternalIdAndTenant(
    externalId: string,
    tenantId: string,
    groupId?: number,
  ): Promise<Dashboard | null> {
    const query = this.createQueryBuilder('dashboards')
      .innerJoin(
        DashboardTenant,
        'dashboard_tenants',
        'dashboard_tenants.dashboardId = dashboards.id',
      )
      .where('dashboard_tenants.tenantId = :tenantId', { tenantId })
      .andWhere('dashboards.externalId = :externalId', { externalId });

    if (groupId !== undefined) {
      query
        .innerJoin(
          DashboardGroup,
          'dashboard_groups',
          'dashboard_groups.dashboardId = dashboards.id',
        )
        .andWhere('dashboard_groups.groupId = :groupId', { groupId });
    }
    return query.getOne();
  }

  async findByGroupIdAndTenant(
    tenantId: string,
    groupIds: number[],
  ): Promise<DashboardWithGroupId[]> {
    const query = this.createQueryBuilder('dashboards')
      .innerJoin(
        DashboardTenant,
        'dashboard_tenants',
        'dashboard_tenants.dashboardId = dashboards.id',
      )
      .innerJoin(
        DashboardGroup,
        'dashboard_groups',
        'dashboard_groups.dashboardId = dashboards.id',
      )
      .addSelect('dashboard_groups.groupId', 'groupId')
      .where('dashboard_tenants.tenantId = :tenantId', { tenantId })
      .andWhere('dashboard_groups.groupId IN (:...groupIds)', { groupIds });

    const { entities, raw } = await query.getRawAndEntities();
    return entities.map((entity, i) => ({
      ...entity,
      groupId: raw[i]['groupId'] as number,
    }));
  }
}
