import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { Scenarios } from '../entity/scenarios.entity';
import { Pagination } from 'src/common/type/common.type';
import { User } from 'src/user/entity/user.entity';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { GetAdminScenarioDto } from '../dto/get-scenario.dto';
import { ScenarioFilters } from '../type/scenario-filter.type';
import { ScenarioTriggerWarnings } from '../entity/scenario-trigger-warnings.entity';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';
import { GetScenarioDto } from '../dto/get-scenario.dto';
import { ScenarioStatus } from '../type/scenario.type';
import { ScenarioTenants } from '../entity/scenario-tenants.entity';
import { GetScenarioResponse } from '../interface/session.interface';

@Injectable()
export class ScenariosRepository extends Repository<Scenarios> {
  constructor(private dataSource: DataSource) {
    super(Scenarios, dataSource.createEntityManager());
  }
  async getScenarioWithTriggerWarningsByIds(ids: number[]) {
    if (ids.length === 0) {
      return [];
    }
    return this.createQueryBuilder('scenario')
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      )
      .where('scenario.id IN (:...ids)', { ids })
      .getMany();
  }

  async getScenarios(filters?: ScenarioFilters): Promise<{
    data: GetScenarioDto[];
    count: number;
  }> {
    const query = this.createQueryBuilder('scenario');
    if (filters?.tenantId) {
      query.innerJoin(
        ScenarioTenants,
        'scenarioTenant',
        'scenarioTenant.scenarioId = scenario.id AND scenarioTenant.tenantId = :tenantId',
        { tenantId: filters.tenantId },
      );
    }

    const [data, count] = await query
      .select([
        'scenario.id',
        'scenario.title',
        'scenario.scenario',
        'scenario.description',
        'scenario.coverImageUrl',
        'scenario.coverVideoUrl',
        'scenario.status',
      ])
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      )
      .where('scenario.status IN (:...statuses)', {
        statuses: [ScenarioStatus.ACTIVE],
      })
      .orderBy('scenario.createdAt', 'DESC')
      .addOrderBy('scenario.id', 'DESC')
      .getManyAndCount();

    return { data, count };
  }

  async getScenarioById(
    id: number,
    select?: (keyof Scenarios)[],
    em?: EntityManager,
  ): Promise<GetScenarioResponse | null> {
    const scenarioRepo = em
      ? em?.getRepository(Scenarios)
      : this.dataSource.getRepository(Scenarios);
    const query = scenarioRepo.createQueryBuilder('scenario');
    if (select) {
      query?.select(select.map((field) => `scenario.${String(field)}`));
    }
    return await query
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'tw',
        'tw.id = stw.triggerWarningId',
      )
      .where('scenario.id = :id', { id })
      .getOne();
  }
  async getAdminScenarios(
    scenarioFilters?: ScenarioFilters,
    options?: Pagination,
  ) {
    const { status, tenantId, search } = scenarioFilters ?? {};
    const query = this.createQueryBuilder('scenario')
      .leftJoin(User, 'user', 'scenario."createdBy"=user.id')
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoin(
        TriggerWarnings,
        'triggerWarnings',
        'triggerWarnings.id = stw.triggerWarningId',
      )
      .select(['scenario', 'user.name'])
      .addSelect(
        `COALESCE(json_agg(json_build_object('id', "triggerWarnings".id, 'name', "triggerWarnings".name)) FILTER (WHERE "triggerWarnings".id IS NOT NULL), '[]')`,
        'triggerWarnings',
      )
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(ScenarioSessions, 'scenarioSessions')
          .where('scenarioSessions.scenarioId = scenario.id');
      }, 'usage')
      .groupBy('scenario.id')
      .addGroupBy('user.name');

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
          'BOOL_OR("scenarioTenants".id IS NOT NULL)',
          'isAssignedToTenant',
        );
    }
    return query.getRawMany();
  }

  async getAdminScenarioById(id: number): Promise<GetAdminScenarioDto | null> {
    return await this.createQueryBuilder('scenario')
      .leftJoinAndMapOne(
        // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): Remove leftJoinAndMapOne
        'scenario.terminationEvent',
        ScenarioEvents,
        'scenarioEvent',
        'scenarioEvent.scenarioId = scenario.id AND scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: true },
      )
      .leftJoinAndMapMany(
        'scenario.terminationEvents',
        ScenarioEvents,
        'scenarioEvent',
        'scenarioEvent.scenarioId = scenario.id AND scenarioEvent.autoTerminationStatus = :autoTerminationStatus',
        { autoTerminationStatus: true },
      )
      .leftJoin(ScenarioTriggerWarnings, 'stw', 'stw.scenarioId = scenario.id')
      .leftJoinAndMapMany(
        'scenario.triggerWarnings',
        TriggerWarnings,
        'triggerWarnings',
        'triggerWarnings.id = stw.triggerWarningId',
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
