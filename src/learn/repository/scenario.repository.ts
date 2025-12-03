import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Scenarios } from '../entity/scenarios.entity';
import { Pagination } from 'src/common/type/common.type';
import { User } from 'src/user/entity/user.entity';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { GetAdminScenarioDto } from '../dto/get-admin-scenario.dto';
import { ScenarioFilters } from '../type/scenario-filter.type';

@Injectable()
export class ScenariosRepository extends Repository<Scenarios> {
  constructor(private dataSource: DataSource) {
    super(Scenarios, dataSource.createEntityManager());
  }
  async getAdminScenarios(
    scenarioFilters?: ScenarioFilters,
    options?: Pagination,
  ) {
    const { status, tenantId, search } = scenarioFilters ?? {};
    const query = this.createQueryBuilder('scenario')
      .leftJoin(User, 'user', 'scenario."createdBy"=user.id')
      .select(['scenario', 'user.name'])
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(ScenarioSessions, 'scenarioSessions')
          .where('scenarioSessions.scenarioId = scenario.id');
      }, 'usage');

    this.applySearchFilter(query, search);

    if (status) {
      const statuses = this.parseStringArray(status);
      if (statuses.length > 0) {
        query.andWhere('scenario.status IN (:...statuses)', {
          statuses,
        });
      }
    }
    if (options?.sortBy) {
      if (options.sortBy === 'usage') {
        query.orderBy('usage', options.order as 'ASC' | 'DESC');
      } else {
        query.orderBy(
          `scenario.${options.sortBy}`,
          options.order as 'ASC' | 'DESC',
        );
      }
    }

    // Pagination
    if (options?.limit) {
      query.limit(options?.limit);
    }
    if (options?.offset) {
      query.offset(options?.offset);
    }

    if (tenantId) {
      query
        .leftJoin(
          'scenario_tenants',
          'scenarioTenants',
          '"scenarioTenants"."scenarioId" = scenario.id AND "scenarioTenants"."tenantId" = :tenantId',
          { tenantId },
        )
        .addSelect(
          'CASE WHEN "scenarioTenants".id IS NOT NULL THEN true ELSE false END',
          'isAssignedToTenant',
        );
    }
    return query.getRawMany();
  }

  async getAdminScenarioById(id: number): Promise<GetAdminScenarioDto | null> {
    return await this.createQueryBuilder('scenario')
      .leftJoinAndMapOne(
        'scenario.terminationEvent',
        ScenarioEvents,
        'scenarioEvent',
        'scenarioEvent.scenarioId = scenario.id AND scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: true },
      )
      .where('scenario.id = :id', { id })
      .getOne();
  }

  private parseStringArray(value?: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  private applySearchFilter(
    query: SelectQueryBuilder<Scenarios>,
    search?: string,
  ) {
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;

      query.andWhere('(scenario.title ILIKE :search)', { search: searchTerm });
    }
  }
}
