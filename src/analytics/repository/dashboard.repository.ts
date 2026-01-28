import { Injectable } from '@nestjs/common';
import { Dashboard } from '../entity/dashboard.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class DashboardRepository extends Repository<Dashboard> {
  constructor(private dataSource: DataSource) {
    super(Dashboard, dataSource.createEntityManager());
  }

  async findByExternalIdAndTenant(
    externalId: string,
    tenantId: string,
    groupId?: string,
  ): Promise<Dashboard | null> {
    const where: { externalId: string; tenantId: string; groupId?: string } = {
      externalId,
      tenantId,
    };
    if (groupId !== undefined) {
      where.groupId = groupId;
    }
    return this.findOne({ where });
  }
}
