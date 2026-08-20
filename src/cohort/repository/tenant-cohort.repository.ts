import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { TenantCohort } from '../entity/tenant-cohort.entity';

@Injectable()
export class TenantCohortRepository extends Repository<TenantCohort> {
  constructor(private dataSource: DataSource) {
    super(TenantCohort, dataSource.createEntityManager());
  }

  async findByTenant(tenantId: string): Promise<TenantCohort[]> {
    return this.find({
      where: { tenantId, deletedAt: IsNull() },
      order: { name: 'ASC' },
    });
  }

  async findOwnedById(
    id: string,
    tenantId: string,
  ): Promise<TenantCohort | null> {
    return this.findOne({ where: { id, tenantId, deletedAt: IsNull() } });
  }

  /**
   * Live member count per cohort for one tenant, keyed by cohort id.
   *
   * Returns a Map rather than the raw rows so callers cannot accidentally treat
   * a cohort missing from the result (zero members) as undefined-and-therefore-
   * broken; the service fills those with 0.
   */
  async countMembersByCohort(tenantId: string): Promise<Map<string, number>> {
    const rows: Array<{ cohortId: string; count: string }> =
      await this.dataSource
        .createQueryBuilder()
        .select('member."cohortId"', 'cohortId')
        .addSelect('COUNT(*)', 'count')
        .from('tenant_cohort_members', 'member')
        .where('member."tenantId" = :tenantId', { tenantId })
        .andWhere('member."deletedAt" IS NULL')
        .groupBy('member."cohortId"')
        .getRawMany();

    return new Map(rows.map((r) => [r.cohortId, Number(r.count)]));
  }

  /**
   * Case-insensitive name collision check within a tenant, mirroring the partial
   * unique index. Checked in the service so the admin gets a readable 409 rather
   * than a raw constraint violation; the index remains the real guarantee.
   */
  async findByNameInsensitive(
    tenantId: string,
    name: string,
    manager?: EntityManager,
  ): Promise<TenantCohort | null> {
    const repo = manager ? manager.getRepository(TenantCohort) : this;
    return repo
      .createQueryBuilder('cohort')
      .where('cohort."tenantId" = :tenantId', { tenantId })
      .andWhere('LOWER(cohort.name) = LOWER(:name)', { name })
      .andWhere('cohort."deletedAt" IS NULL')
      .getOne();
  }
}
