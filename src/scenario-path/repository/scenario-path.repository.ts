import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioPath } from '../entity/scenario-path.entity';
import {
  ScenarioPathFilterOptions,
  ScenarioPathsWithSession,
  ScenarioPathWithSession,
  ScenarioPathWithSessionFilterOptions,
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
      query.orderBy(
        `scenarioPath.${filters.sortBy}`,
        filters.order as 'ASC' | 'DESC',
      );
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
      query.orderBy(
        `scenarioPathSession.${filters.sortBy}`,
        filters.order as 'ASC' | 'DESC',
      );
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
}
