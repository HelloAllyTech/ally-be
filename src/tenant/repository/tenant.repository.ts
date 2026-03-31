import { Injectable } from '@nestjs/common';
import { Tenant, TenantStatus } from 'src/tenant/entity/tenant.entity';
import { Pagination } from 'src/common/type/common.type';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { TenantSortBy } from '../enum/tenant.enum';

@Injectable()
export class TenantsRepository extends Repository<Tenant> {
  tenantRepository: any;
  constructor(private dataSource: DataSource) {
    super(Tenant, dataSource.createEntityManager());
  }

  async getAllTenants(
    search?: string,
    options?: Pagination,
    tenantIds?: string[],
  ) {
    const query = this.createQueryBuilder('tenant').select(['tenant']);

    this.applySearchFilter(query, search);

    if (tenantIds && tenantIds.length > 0) {
      query.andWhere('tenant.id IN (:...tenantIds)', { tenantIds });
    }

    if (options?.sortBy) {
      const sortColumn = this.getValidatedSortColumn(options.sortBy);
      if (sortColumn) {
        query.orderBy(`tenant.${sortColumn}`, options.order as 'ASC' | 'DESC');
      }
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

      query.andWhere(
        '(tenant.name ILIKE :search OR tenant.code ILIKE :search)',
        {
          search: searchTerm,
        },
      );
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return null;
    }
    const validColumns = Object.values(TenantSortBy);
    return validColumns.includes(sortBy as TenantSortBy) ? sortBy : null;
  }

  async updateStatus(id: string, status: TenantStatus): Promise<Tenant | null> {
    const result = await this.tenantRepository
      .createQueryBuilder()
      .update(Tenant)
      .set({ status })
      .where('id = :id', { id })
      .returning('*')
      .execute();
    return result.affected ? result.raw[0] : null;
  }
}
