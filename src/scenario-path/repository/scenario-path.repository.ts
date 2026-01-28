import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioPath } from '../entity/scenario-path.entity';
import {
  ScenarioPathFilterOptions,
  ScenarioPathsWithSession,
  ScenarioPathWithSession,
  ScenarioPathWithSessionFilterOptions,
  ScenarioPathSortBy,
} from '../type/scenario-paths.type';
import { ScenarioPathSession } from '../entity/scenario-path-session.entity';

@Injectable()
export class ScenarioPathRepository extends Repository<ScenarioPath> {
  constructor(private dataSource: DataSource) {
    super(ScenarioPath, dataSource.createEntityManager());
  }

  async getAllScenarioPaths(filters?: ScenarioPathFilterOptions): Promise<{
    data: (ScenarioPath & { isAssignedToTenant?: boolean })[];
    count: number;
  }> {
    const query = this.createQueryBuilder('scenarioPath');

    if (filters?.tenantId) {
      query
        .leftJoinAndMapOne(
          'scenarioPath.scenarioPathTenant',
          'scenario_path_tenants',
          'scenarioPathTenant',
          '"scenarioPathTenant"."scenarioPathId" = scenarioPath.id AND "scenarioPathTenant"."tenantId" = :tenantId',
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
        query.orderBy(
          `scenarioPath.${sortColumn}`,
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

    return { data, count };
  }

  private applyStatusFilter(
    query: SelectQueryBuilder<ScenarioPath>,
    filters?: ScenarioPathFilterOptions,
  ): void {
    if (filters?.status) {
      query.andWhere('scenarioPath.status IN (:...status)', {
        status: filters.status,
      });
    }
  }

  private applySearchFilter(
    query: SelectQueryBuilder<ScenarioPath>,
    filters?: ScenarioPathFilterOptions,
  ): void {
    if (filters?.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      query.andWhere('(scenarioPath.title ILIKE :search)', {
        search: searchTerm,
      });
    }
  }

  async getAllScenarioPathsWithSession(
    filters: ScenarioPathWithSessionFilterOptions,
  ): Promise<ScenarioPathsWithSession> {
    const query = this.createQueryBuilder('scenarioPath')
      .leftJoinAndMapOne(
        'scenarioPath.session',
        ScenarioPathSession,
        'scenarioPathSession',
        '"scenarioPathSession"."scenarioPathId" = scenarioPath.id AND scenarioPathSession.userId = :userId',
      )
      .setParameters({ userId: filters.userId });

    query.where('scenarioPath.status = :status', { status: filters.status });
    if (filters.tenantId) {
      query
        .innerJoin(
          'scenario_path_tenants',
          'scenarioPathTenant',
          '"scenarioPathTenant"."scenarioPathId" = scenarioPath.id AND scenarioPathTenant.tenantId = :tenantId',
        )
        .setParameters({
          tenantId: filters.tenantId,
        });
    }

    if (filters?.sortBy) {
      const sortColumn = this.getValidatedSortColumn(filters.sortBy);
      if (sortColumn) {
        query.orderBy(
          `scenarioPathSession.${sortColumn}`,
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

    return { data: data as ScenarioPathWithSession[], count };
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return null;
    }
    const validColumns = Object.values(ScenarioPathSortBy);
    return validColumns.includes(sortBy as ScenarioPathSortBy) ? sortBy : null;
  }
}
