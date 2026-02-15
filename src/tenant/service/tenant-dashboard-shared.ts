import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Dashboard } from 'src/analytics/entity/dashboards.entity';
import { DashboardTenant } from 'src/analytics/entity/dashboard-tenant.entity';

@Injectable()
export class TenantDashboardSharedService {
  constructor() {}

  async getEnabledDashboardIdsForTenants(
    tenantIds: string[],
    entityManager: EntityManager,
  ): Promise<{ tenantId: string; dashboardIds: string[] }[]> {
    const results = await entityManager
      .createQueryBuilder(DashboardTenant, 'dt')
      .select('dt.tenantId', 'tenantId')
      .addSelect('ARRAY_AGG(dt.dashboardId)', 'dashboardIds')
      .where('dt.tenantId IN (:...tenantIds)', { tenantIds })
      .groupBy('dt.tenantId')
      .getRawMany<{ tenantId: string; dashboardIds: string[] }>();

    return results;
  }

  async assignDashboardsToTenant(
    tenantId: string,
    enabledDashboardIds: string[],
    entityManager: EntityManager,
  ): Promise<void> {
    const dashboardTenantRepository =
      entityManager.getRepository(DashboardTenant);

    const requestedDashboardIdSet = new Set(enabledDashboardIds);

    const existingDashboards = await dashboardTenantRepository.find({
      where: { tenantId },
      select: ['dashboardId'],
    });
    const existingDashboardIds = new Set(
      existingDashboards.map((link) => link.dashboardId),
    );

    const dashboardsToAdd = [...requestedDashboardIdSet].filter(
      (id) => !existingDashboardIds.has(id),
    );
    const dashboardsToRemove = [...existingDashboardIds].filter(
      (id) => !requestedDashboardIdSet.has(id),
    );

    if (dashboardsToRemove.length > 0) {
      await dashboardTenantRepository.softDelete({
        tenantId,
        dashboardId: In(dashboardsToRemove),
      });
    }
    if (dashboardsToAdd.length > 0) {
      const dashboardTenants = dashboardsToAdd.map((dashboardId) =>
        dashboardTenantRepository.create({ dashboardId, tenantId }),
      );
      await dashboardTenantRepository.save(dashboardTenants);
    }
  }

  async validateDashboardIds(
    enabledDashboardIds: string[],
    entityManager: EntityManager,
  ): Promise<void> {
    const dashboardRepository = entityManager.getRepository(Dashboard);

    const dashboards = await dashboardRepository.find({
      where: { id: In(enabledDashboardIds) },
    });

    if (dashboards.length != enabledDashboardIds.length) {
      throw new NotFoundException('One or more dashboards not found');
    }
  }
}
