import { Injectable } from '@nestjs/common';
import { Tenant } from 'src/tenant/entity/tenant.entity';
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

    const count = await query.getCount();
    // Pagination
    if (options?.limit) {
      query.limit(options?.limit);
    }
    if (options?.offset) {
      query.offset(options?.offset);
    }
    const tenants = await query.getMany();
    return {
      tenants,
      count,
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
