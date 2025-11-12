import { Injectable } from '@nestjs/common';
import { Tenant, TenantStatus } from 'src/tenant/entity/tenant.entity';
import { Pagination } from 'src/common/type/common.type';
import {
  DataSource,
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

@Injectable()
export class TenantsRepository extends Repository<Tenant> {
  constructor(private dataSource: DataSource) {
    super(Tenant, dataSource.createEntityManager());
  }

  async findAll(
    options?: FindManyOptions<Tenant>,
    entityManager?: EntityManager,
  ): Promise<Tenant[]> {
    const repository = entityManager
      ? entityManager.getRepository(Tenant)
      : this;
    return repository.find(options || {});
  }

  async findOneByOptions(
    options: FindOneOptions<Tenant>,
    entityManager?: EntityManager,
  ): Promise<Tenant | null> {
    const repository = entityManager
      ? entityManager.getRepository(Tenant)
      : this;
    return repository.findOne(options);
  }

  async createTenant(
    tenantData: Partial<Tenant>,
    entityManager?: EntityManager,
  ): Promise<Tenant> {
    const repository = entityManager
      ? entityManager.getRepository(Tenant)
      : this;
    const tenant = repository.create(tenantData);
    return repository.save(tenant);
  }

  async updateTenant(
    id: string,
    data: Partial<Tenant>,
    entityManager?: EntityManager,
  ): Promise<boolean> {
    const repository = entityManager
      ? entityManager.getRepository(Tenant)
      : this;
    const result = await repository.update(id, data);
    return result.affected !== 0;
  }

  async updateStatusAndReturn(
    id: string,
    status: TenantStatus,
    entityManager?: EntityManager,
  ): Promise<Tenant | null> {
    const repository = entityManager
      ? entityManager.getRepository(Tenant)
      : this;
    const result = await repository
      .createQueryBuilder()
      .update(Tenant)
      .set({ status })
      .where('id = :id', { id })
      .returning('*')
      .execute();
    return result.affected ? result.raw[0] : null;
  }

  async getallTenants(
    search?: string,
    options?: Pagination,
    entityManager?: EntityManager,
  ) {
    const repository = entityManager
      ? entityManager.getRepository(Tenant)
      : this;
    const query = repository.createQueryBuilder('tenant').select(['tenant']);

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
