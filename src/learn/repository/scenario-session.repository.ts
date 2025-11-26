import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Pagination } from 'src/common/type/common.type';
import { Scenarios } from '../entity/scenarios.entity';
import { User } from 'src/user/entity/user.entity';
import { StartScenarioSessionRequestDto } from '../dto/start-scenario-session-request.dto';
import { ScenarioSessionDetails } from '../entity/scenario-session-details.entity';
import { ScenarioSessionEvents } from '../entity/scenario-session-events.entity';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';

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
      .withDeleted()
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
    if (options.sortBy && options.order) {
      query.orderBy(`"scenarioSession"."${options.sortBy}"`, options.order);
    }
  }

  async getAdminScenarioSessions(options: Pagination, statuses?: string) {
    const query = this.createQueryBuilder('scenarioSession')
      .withDeleted()
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

    this.applyStatusFilters(query, statuses || '');
    this.applyPagination(query, options);
    this.applySorting(query, options);
    return query.getMany();
  }

  async createScenarioSession(
    counselorId: number,
    createScenarioSessionDto: StartScenarioSessionRequestDto,
  ): Promise<ScenarioSessions> {
    const uuid = uuidv4();

    // Get the current sequence value for session name
    const sequenceResult = await this.query(
      `SELECT last_value from scenario_sessions_id_seq`,
    );
    const sessionId = sequenceResult[0]?.last_value;
    const startedAt = new Date();
    const date = startedAt.toISOString().split('T')[0];

    const scenarioSession = this.create({
      id: uuid,
      roomId: `ss_${uuid}`,
      counselorId,
      scenarioId: createScenarioSessionDto.scenarioId,
      startedAt,
      tenantId: ExecutionManager.getTenantId(),
      scenarioPathSessionItemId:
        createScenarioSessionDto.scenarioPathSessionItemId,
      metadata: {
        sessionName: `SS-${sessionId}-${date}`,
      },
    });

    return this.save(scenarioSession);
  }

  async getScenarioSession(
    scenarioSessionId: string,
    counselorId: number,
    isAdmin: boolean = false,
  ) {
    const query = this.createQueryBuilder('scenarioSession')
      .withDeleted()
      .leftJoinAndMapOne(
        'scenarioSession.scenario',
        Scenarios,
        'scenario',
        'scenario.id = scenarioSession.scenarioId',
      )
      .leftJoinAndMapOne(
        'scenarioSession.details',
        ScenarioSessionDetails,
        'scenarioSessionDetails',
        '"scenarioSessionDetails"."scenarioSessionId"::uuid = scenarioSession.id',
      )
      .withDeleted()
      .leftJoinAndMapMany(
        'scenarioSession.events',
        ScenarioSessionEvents,
        'scenarioSessionEvent',
        '"scenarioSessionEvent"."scenarioSessionId"::uuid = scenarioSession.id',
      )
      .leftJoinAndMapOne(
        'scenarioSessionEvent.events',
        SessionEvents,
        'events',
        'events.id = scenarioSessionEvent.eventId',
      )
      .where('scenarioSession.id = :scenarioSessionId', { scenarioSessionId })
      .andWhere('scenarioSession.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      });

    if (!isAdmin) {
      query.andWhere('scenarioSession.counselorId = :counselorId', {
        counselorId,
      });
    }

    return query.orderBy('scenarioSessionEvent.occurredAt', 'ASC').getOne();
  }

  async getScenarioSessionScore(scenarioSessionId: string) {
    const totalScoreResult = await this.createQueryBuilder('scenarioSession')
      .leftJoin(
        ScenarioSessionEvents,
        'scenarioSessionEvent',
        '"scenarioSessionEvent"."scenarioSessionId"::uuid = scenarioSession.id',
      )
      .leftJoin(
        SessionEvents,
        'events',
        'events.id = scenarioSessionEvent.eventId AND events.visibilityType = :visibilityType',
      )
      .setParameters({
        visibilityType: SessionEventVisibilityType.ACTIVE,
      })
      .select('COALESCE(SUM(scenarioSessionEvent.score), 0)', 'totalScore')
      .where('scenarioSession.id = :scenarioSessionId', { scenarioSessionId })
      .andWhere('scenarioSession.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
      .getRawOne();

    const totalScore = parseFloat(totalScoreResult?.totalScore) || 0;

    return totalScore;
  }
}
