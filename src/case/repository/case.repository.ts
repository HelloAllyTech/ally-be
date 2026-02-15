import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Case } from '../entity/case.entity';
import {
  CaseFilterOptions,
  CaseSortBy,
  CaseWithSession,
  CaseWithSessionFilterOptions,
  CasesWithSession,
} from '../type/cases.type';
import { CaseSession } from '../entity/case-session.entity';

@Injectable()
export class CaseRepository extends Repository<Case> {
  constructor(private dataSource: DataSource) {
    super(Case, dataSource.createEntityManager());
  }

  async getAllCases(filters?: CaseFilterOptions): Promise<{
    data: (Case & { isAssignedToTenant?: boolean })[];
    count: number;
  }> {
    const query = this.createQueryBuilder('case');

    if (filters?.tenantId) {
      query
        .leftJoinAndMapOne(
          'case.caseTenant',
          'case_tenants',
          'caseTenant',
          '"caseTenant"."caseId" = case.id AND "caseTenant"."tenantId" = :tenantId',
        )
        .setParameters({
          tenantId: filters.tenantId,
        });
    }

    this.applyStatusFilter(query, filters);
    this.applySearchFilter(query, filters);

    if (filters?.sortBy) {
      const sortColumn = this.getValidatedSortColumn(filters.sortBy);
      if (sortColumn) {
        query.orderBy(`case.${sortColumn}`, filters.order as 'ASC' | 'DESC');
      }
    }

    if (filters?.limit) {
      query.limit(filters.limit);
    }

    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const [data, count] = await query.getManyAndCount();

    return { data, count };
  }

  async getAllCasesWithSession(
    filters: CaseWithSessionFilterOptions,
  ): Promise<CasesWithSession> {
    const query = this.createQueryBuilder('case')
      .leftJoinAndMapOne(
        'case.session',
        CaseSession,
        'caseSession',
        '"caseSession"."caseId" = case.id AND caseSession.userId = :userId',
      )
      .setParameters({ userId: filters.userId });

    query.where('case.status = :status', { status: filters.status });
    if (filters.tenantId) {
      query
        .innerJoin(
          'case_tenants',
          'caseTenant',
          '"caseTenant"."caseId" = case.id AND caseTenant.tenantId = :tenantId',
        )
        .setParameters({
          tenantId: filters.tenantId,
        });
    }

    if (filters?.sortBy) {
      const sortColumn = this.getValidatedSortColumn(filters.sortBy);
      if (sortColumn) {
        query.orderBy(
          `caseSession.${sortColumn}`,
          filters.order as 'ASC' | 'DESC',
        );
      }
    }

    if (filters?.limit) {
      query.limit(filters.limit);
    }

    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const [data, count] = await query.getManyAndCount();

    return { data: data as CaseWithSession[], count };
  }

  private applyStatusFilter(
    query: SelectQueryBuilder<Case>,
    filters?: CaseFilterOptions,
  ): void {
    if (filters?.status) {
      query.andWhere('case.status IN (:...status)', {
        status: filters.status,
      });
    }
  }

  private applySearchFilter(
    query: SelectQueryBuilder<Case>,
    filters?: CaseFilterOptions,
  ): void {
    if (filters?.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      query.andWhere('(case.title ILIKE :search)', {
        search: searchTerm,
      });
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return null;
    }
    const validColumns = Object.values(CaseSortBy);
    return validColumns.includes(sortBy as CaseSortBy) ? sortBy : null;
  }
}
