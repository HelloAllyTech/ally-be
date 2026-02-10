import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Dashboard } from 'src/analytics/entity/dashboards.entity';
import { DashboardTenant } from 'src/analytics/entity/dashboard-tenant.entity';

@Injectable()
export class TenantDashboardSharedService {
  private static readonly logger = LoggerService.getInstance(
    TenantDashboardSharedService.name,
  );

  constructor() {}

  async getEnabledDashboardIdsForTenant(
    tenantId: string,
    entityManager: EntityManager,
  ): Promise<string[]> {
    const repo = entityManager.getRepository(DashboardTenant);
    const dashboardTenants = await repo.find({
      where: { tenantId },
      select: ['dashboardId'],
    });
    return dashboardTenants.map((dt) => dt.dashboardId);
  }

  async assignDashboardsToTenant(
    tenantId: string,
    enabledDashboardIds: string[],
    entityManager: EntityManager,
  ): Promise<void> {
    const dashboardTenantRepository =
      entityManager.getRepository(DashboardTenant);

    const dashboardTenants = enabledDashboardIds.map((dashboardId) =>
      dashboardTenantRepository.create({
        dashboardId,
        tenantId,
      }),
    );

    await dashboardTenantRepository.save(dashboardTenants);
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
