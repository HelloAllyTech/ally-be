import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AdminTenant } from '../entity/admin-tenant.entity';

@Injectable()
export class AdminTenantRepository extends Repository<AdminTenant> {
  constructor(private dataSource: DataSource) {
    super(AdminTenant, dataSource.createEntityManager());
  }

  findByUserId(userId: number): Promise<AdminTenant[]> {
    return this.find({ where: { userId, deletedAt: IsNull() } });
  }

  findByUserIdAndTenantIds(
    userId: number,
    tenantIds: string[],
  ): Promise<AdminTenant[]> {
    return this.find({
      where: { userId, tenantId: In(tenantIds), deletedAt: IsNull() },
    });
  }

  /** Finds active AND soft-deleted mappings — used to restore previously removed tenants. */
  findByUserIdAndTenantIdsIncludingDeleted(
    userId: number,
    tenantIds: string[],
  ): Promise<AdminTenant[]> {
    return this.find({
      where: { userId, tenantId: In(tenantIds) },
      withDeleted: true,
    });
  }
}
