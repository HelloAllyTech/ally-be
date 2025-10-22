import { Tenant } from 'src/common/entities/tenant.entity';
import { User } from 'src/common/entities/user.entity';
import { Repository } from 'typeorm/repository/Repository.js';
import { UserFilterOptions } from '../interface/user-filter-options.interface';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { UserGroup } from 'src/common/entities/user-group.entity';

@Injectable()
export class UserRepository extends Repository<User> {
  constructor(private dataSource: DataSource) {
    super(User, dataSource.createEntityManager());
  }

  async getAllUsers(filters?: UserFilterOptions) {
    const query = this.createQueryBuilder('user')
      .innerJoin(Tenant, 'tenant', '"tenant"."id" = ("user"."tenant_id")::uuid')
      .select(['user', '"tenant"."name" AS "tenant_name"']);

    this.applyTenantIdFilter(query, filters);
    this.applyRolesFilter(query, filters);
    this.applyStatusFilter(query, filters);
    this.applySearchFilter(query, filters);

    // Sorting
    if (filters?.sortBy) {
      query.orderBy(`user.${filters.sortBy}`, filters.order as 'ASC' | 'DESC');
    }

    const totalCount = await query.getCount();

    if (totalCount === 0) {
      return { users: [], rolesMap: new Map(), count: 0 };
    }

    // Pagination
    if (filters?.limit) {
      query.limit(filters.limit);
    }

    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const users = await query.getRawMany();
    if (users.length === 0) {
      return { users: [], rolesMap: new Map(), count: 0 };
    }
    const userIds = users.map((u) => u.user_id);

    const roles = await this.dataSource
      .createQueryBuilder(UserGroup, 'ug')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      .where('ug."userId" IN (:...userIds)', { userIds })
      .select('ug."userId"', 'userId')
      .addSelect('ARRAY_AGG(DISTINCT g.name)', 'roles')
      .groupBy('ug."userId"')
      .getRawMany();

    const rolesMap = new Map(roles.map((r) => [r.userId, r.roles]));

    return { users, rolesMap, count: totalCount };
  }
  private applyTenantIdFilter(
    query: SelectQueryBuilder<User>,
    filters?: UserFilterOptions,
  ) {
    if (filters?.tenantIds) {
      const tenantIds = this.parseStringArray(filters.tenantIds);

      if (tenantIds.length > 0) {
        query.andWhere('CAST(user.tenantId AS TEXT) IN (:...tenantIds)', {
          tenantIds,
        });
      }
    }
  }

  private applyRolesFilter(
    query: SelectQueryBuilder<User>,
    filters?: UserFilterOptions,
  ) {
    if (filters?.roles) {
      const roles = this.parseStringArray(filters.roles);
      if (roles.length > 0) {
        query.andWhere(
          `EXISTS (
    SELECT 1 
    FROM user_groups ug
    INNER JOIN groups g ON g.id = ug."groupId"
    WHERE ug."userId" = "user"."id"
    AND g.name IN (:...roles)
  )`,
          { roles },
        );
      }
    }
  }

  private applyStatusFilter(
    query: SelectQueryBuilder<User>,
    filters?: UserFilterOptions,
  ) {
    if (filters?.statuses) {
      const statuses = this.parseStringArray(filters.statuses);
      if (statuses.length > 0) {
        query.andWhere('user.status IN (:...statuses)', {
          statuses,
        });
      }
    }
  }

  private applySearchFilter(
    query: SelectQueryBuilder<User>,
    filters?: UserFilterOptions,
  ) {
    if (filters?.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      query.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', {
        search: searchTerm,
      });
    }
  }

  private parseStringArray(value?: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
