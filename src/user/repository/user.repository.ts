import { Tenant } from 'src/common/entities/tenant.entity';
import { User } from 'src/common/entities/user.entity';
import { Repository } from 'typeorm/repository/Repository.js';
import { UserFilterOptions } from '../interface/user-filter-options.interface';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { SimulationCredits } from 'src/learn/entity/simulation-credits.entity';

@Injectable()
export class UserRepository extends Repository<User> {
  constructor(private dataSource: DataSource) {
    super(User, dataSource.createEntityManager());
  }

  async getAllUsers(filters?: UserFilterOptions, isAdmin: boolean = true) {
    const query = this.createQueryBuilder('user')
      .innerJoin(Tenant, 'tenant', '"tenant"."id" = ("user"."tenant_id")::uuid')
      .leftJoin(
        SimulationCredits,
        'simulationCredits',
        'simulationCredits.userId = user.id',
      )
      .select([
        'user',
        '"tenant"."name" AS "tenant_name"',
        'COALESCE(simulationCredits.creditLimit, 0) AS "simulation_credit_limit"',
        'COALESCE(simulationCredits.consumedCredits, 0) AS "simulation_consumed_credits"',
      ]);

    this.applyTenantIdFilter(query, filters);
    this.applyRolesFilter(query, filters, isAdmin);
    this.applyStatusFilter(query, filters);
    this.applySearchFilter(query, filters);

    // Sorting
    if (filters?.sortBy) {
      query.orderBy(`user.${filters.sortBy}`, filters.order as 'ASC' | 'DESC');
    }

    const totalCount = await query.getCount();

    if (totalCount === 0) {
      return { users: [], count: 0 };
    }

    // Pagination
    if (filters?.limit) {
      query.limit(filters.limit);
    }

    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const users = await query.getRawMany();

    return { users, count: totalCount };
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
    isAdmin?: boolean,
  ) {
    if (isAdmin || filters?.roles) {
      const conditions: string[] = [];
      const params: Record<string, any> = {};

      if (isAdmin) {
        conditions.push(
          `NOT EXISTS (
        SELECT 1
        FROM user_groups ug_excl
        INNER JOIN groups g_excl ON g_excl.id = ug_excl."groupId"
        WHERE ug_excl."userId" = "user"."id" AND g_excl.name = :superAdminRole
      )`,
        );
        params.superAdminRole = 'SUPER_ADMIN';
      }

      if (filters?.roles) {
        const roles = this.parseStringArray(filters.roles);
        if (roles.length > 0) {
          conditions.push(
            `EXISTS (
          SELECT 1
          FROM user_groups ug
          INNER JOIN groups g ON g.id = ug."groupId"
          WHERE ug."userId" = "user"."id"
          AND g.name IN (:...roles)
        )`,
          );
          params.roles = roles;
        }
      }
      if (conditions.length > 0) {
        query.andWhere(conditions.join(' AND '), params);
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

  async getUserCount(tenantIds: string[]) {
    const userCounts = await this.dataSource
      .createQueryBuilder(User, 'user')
      .select('user.tenant_id', 'tenantId')
      .addSelect('COUNT(*)', 'userCount')
      .where('user.tenant_id IN (:...tenantIds)', { tenantIds })
      .groupBy('user.tenant_id')
      .getRawMany();

    return userCounts;
  }
}
