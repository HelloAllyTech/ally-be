import { Injectable } from '@nestjs/common';
import { Tenant } from 'src/common/entities/tenant.entity';
import { User } from 'src/common/entities/user.entity';
import { Pagination } from 'src/common/type/common.type';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';

@Injectable()
export class TenantsRepository extends Repository<Tenant> {
  tenantRepository: any;
  constructor(private dataSource: DataSource) {
    super(Tenant, dataSource.createEntityManager());
  }
  async getallTenants(search?: string, options?: Pagination) {
    const query = this.createQueryBuilder('tenant').select(['tenant']);

    this.applySearchFilter(query, search);

    if (options?.sortBy) {
      query.orderBy(
        `tenant.${options?.sortBy}`,
        options.order as 'ASC' | 'DESC',
      );
    }

    const totalCount = await query.getCount();
    // Pagination
    if (options?.limit) {
      query.limit(options?.limit);
    }
    if (options?.offset) {
      query.offset(options?.offset);
    }
    const tenants = await query.getMany();

    if (tenants.length == 0) {
      return { data: [], total: 0 };
    }

    const tenantIds = tenants.map((t) => t.id);
    const userCounts = await this.dataSource
      .createQueryBuilder(User, 'user')
      .select('user.tenant_id', 'tenantId')
      .addSelect('COUNT(*)', 'userCount')
      .where('user.tenant_id IN (:...tenantIds)', { tenantIds })
      .groupBy('user.tenant_id')
      .getRawMany();

    const userCountMap = new Map(
      userCounts.map((uc) => [uc.tenantId, parseInt(uc.userCount)]),
    );

    const tenantsWithUserCount = tenants.map((tenant) => ({
      ...tenant,
      userCount: userCountMap.get(tenant.id) || 0,
    }));

    return {
      data: tenantsWithUserCount,
      total: totalCount,
    };
  }
  private applySearchFilter(
    query: SelectQueryBuilder<Tenant>,
    search?: string,
  ) {
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;

      query.andWhere('(tenant.name ILIKE :search )', {
        search: searchTerm,
      });
    }
  }
}
