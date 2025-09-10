import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Pagination } from 'src/common/type/common.type';
import { Scenarios } from '../entity/scenarios.entity';
import { User } from 'src/common/entities/user.entity';
import { StartScenarioSessionRequestDto } from '../dto/start-scenario-session-request.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ScenarioSessionRepository extends Repository<ScenarioSessions> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessions, dataSource.createEntityManager());
  }

  async getScenarioSessions(
    counselorId: number,
    options: Pagination,
    statuses?: string,
  ) {
    const query = this.createQueryBuilder('scenarioSession')
      .leftJoinAndMapOne(
        'scenarioSession.scenario',
        Scenarios,
        'scenario',
        'scenario.id = scenarioSession.scenarioId',
      )
      .where('scenarioSession.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
      .andWhere('scenarioSession.counselorId = :counselorId', { counselorId });

    this.applyStatusFilters(query, statuses || '');
    this.applyPagination(query, options);
    this.applySorting(query, options);

    return query.getMany();
  }

  private applyStatusFilters(
    query: SelectQueryBuilder<ScenarioSessions>,
    statuses: string,
  ) {
    if (statuses) {
      const status = statuses
        .split(',')
        .map((status) => status.trim())
        .filter((status) => status !== '');
      query.andWhere('scenarioSession.status IN (:...status )', { status });
    }
  }

  private applyPagination(
    query: SelectQueryBuilder<ScenarioSessions>,
    options: Pagination,
  ) {
    if (options.limit) {
      query.limit(options.limit);
    }
    if (options.offset) {
      query.offset(options.offset);
    }
  }

  private applySorting(
    query: SelectQueryBuilder<ScenarioSessions>,
    options: Pagination,
  ) {
    if (options.sortBy) {
      query.orderBy(
        `scenarioSession.${options.sortBy}`,
        options.order as 'ASC' | 'DESC',
      );
    }
  }

  async getAdminScenarioSessions(options: Pagination) {
    const query = this.createQueryBuilder('scenarioSession')
      .leftJoinAndMapOne(
        'scenarioSession.scenario',
        Scenarios,
        'scenario',
        'scenario.id = scenarioSession.scenarioId',
      )
      .leftJoinAndMapOne(
        'scenarioSession.counselor',
        User,
        'counselor',
        'counselor.id = scenarioSession.counselorId',
      )
      .where('scenarioSession.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      });

    this.applyPagination(query, options);
    this.applySorting(query, options);
    return query.getMany();
  }

  async createScenarioSession(
    counselorId: number,
    startScenarioSessionDto: StartScenarioSessionRequestDto,
  ): Promise<ScenarioSessions> {
    const uuid = uuidv4();

    const scenarioSession = this.create({
      id: uuid,
      roomId: `ss_${uuid}`,
      counselorId,
      scenarioId: startScenarioSessionDto.scenarioId,
      startedAt: new Date(),
      tenantId: ExecutionManager.getTenantId(),
    });

    return this.save(scenarioSession);
  }
}
