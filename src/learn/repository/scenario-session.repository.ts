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
import { ScenarioSessionSortBy } from '../enum/scenario-session-sort-by.enum';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../enum/scenario-session-status.enum';
import { countableSessionPredicate } from 'src/analytics/util/session-eligibility.util';
import { ScenarioCompletionSummary } from '../interface/scenario-completion.interface';

type CreateScenarioSessionDto = StartScenarioSessionRequestDto & {
  voiceId?: string;
};

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

  private getValidatedSortColumn(sortBy: string): string | null {
    const allowedColumns = Object.values(ScenarioSessionSortBy);
    if (allowedColumns.includes(sortBy as ScenarioSessionSortBy)) {
      return sortBy;
    }
    return null;
  }

  private applySorting(
    query: SelectQueryBuilder<ScenarioSessions>,
    options: Pagination,
  ) {
    if (options.sortBy && options.order) {
      const sortColumn = this.getValidatedSortColumn(options.sortBy);
      if (sortColumn) {
        query.orderBy(`"scenarioSession"."${sortColumn}"`, options.order);
      }
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
    createScenarioSessionDto: CreateScenarioSessionDto,
  ): Promise<ScenarioSessions> {
    const uuid = uuidv4();

    // Get the current sequence value for session name
    const sequenceResult = await this.query(
      `SELECT last_value from scenario_sessions_id_seq`,
    );
    const sessionId = sequenceResult[0]?.last_value;
    const currentDate = new Date();
    const date = currentDate.toISOString().split('T')[0];

    const scenarioSession = this.create({
      id: uuid,
      roomId: `ss_${uuid}`,
      counselorId,
      scenarioId: createScenarioSessionDto.scenarioId,
      scenarioVersionId: createScenarioSessionDto.scenarioVersionId ?? null,
      tenantId: ExecutionManager.getTenantId(),
      scenarioPathSessionItemId:
        createScenarioSessionDto.scenarioPathSessionItemId,
      caseSessionItemId: createScenarioSessionDto.caseSessionItemId,
      trackItemProgressId: createScenarioSessionDto.trackItemProgressId,
      metadata: {
        sessionName: `SS-${sessionId}-${date}`,
        languageId: createScenarioSessionDto?.languageId,
        voiceId: createScenarioSessionDto.voiceId,
        platform: createScenarioSessionDto.platform ?? 'unknown',
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
        '"scenarioSessionEvent"."scenarioSessionId"::uuid = scenarioSession.id AND "scenarioSessionEvent"."autoTerminationStatus" = false',
      )
      .leftJoinAndMapOne(
        'scenarioSessionEvent.events',
        SessionEvents,
        'events',
        'events.id = scenarioSessionEvent.eventId AND events.visibilityType = :visibilityType',
        { visibilityType: SessionEventVisibilityType.ACTIVE },
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

  /**
   * How many times this user has *completed* each of the given scenarios, and
   * when they last did. Powers the "already completed" indicator on the learner
   * catalog and scenario detail page.
   *
   * "Completed" is the analytics definition — `status = ENDED` AND
   * `eventStatus = COMPLETED`, i.e. the roleplay reached its natural end and
   * produced a score — not the looser `status = ENDED` that
   * `getScenarioSessions` defaults to, which also counts dropped calls. There
   * is no ABANDONED status to filter on, so this pairing is the only signal.
   * Keeping it aligned with analytics means the badge reconciles with the
   * dashboards.
   *
   * `tenant_id` is a varchar on scenario_sessions (BaseEntity) written from
   * ExecutionManager.getTenantId() at creation, so it compares to the request
   * tenant with a plain bind — do not join it against the uuid tenant columns.
   */
  async getCompletionsForUser(params: {
    userId: number;
    tenantId: string;
    scenarioIds: number[];
  }): Promise<Map<number, ScenarioCompletionSummary>> {
    const completions = new Map<number, ScenarioCompletionSummary>();
    if (!params.userId || !params.tenantId || !params.scenarioIds?.length) {
      return completions;
    }

    const rows = await this.createQueryBuilder('s')
      .select('s.scenarioId', 'scenario_id')
      .addSelect('COUNT(*)::int', 'attempt_count')
      .addSelect('MAX(s.endedAt)', 'last_completed_at')
      .where('s.counselorId = :userId', { userId: params.userId })
      .andWhere('s.tenantId = :tenantId', { tenantId: params.tenantId })
      .andWhere('s.status = :status', { status: ScenarioSessionStatus.ENDED })
      .andWhere('s.eventStatus = :eventStatus', {
        eventStatus: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('s.scenarioId IN (:...scenarioIds)', {
        scenarioIds: params.scenarioIds,
      })
      .andWhere(countableSessionPredicate('s'))
      .groupBy('s.scenarioId')
      .getRawMany<{
        scenario_id: number;
        attempt_count: number;
        last_completed_at: Date | null;
      }>();

    rows.forEach((row) => {
      completions.set(Number(row.scenario_id), {
        attemptCount: Number(row.attempt_count),
        lastCompletedAt: row.last_completed_at,
      });
    });

    return completions;
  }

  /**
   * Ended sessions that have a transcript but were never picked up by the actor
   * goal judge — the input to the catch-up task.
   *
   * The judge only fires from `handleEndScenarioSessionEvent`, i.e. off the
   * agent's `end-of-session` SQS message. When the agent never joins, dies
   * mid-session, or the worker gives up reconnecting, that message never
   * arrives and the session is silently never scored, while the learner summary
   * (driven by the separate client/REST end path) still runs.
   *
   * `evaluationStatus IS NULL` means "never triggered". FAILED is deliberately
   * excluded: the judge did run, and auto-retrying a permanently failing
   * session every tick would burn tokens forever. FAILED stays retriggerable by
   * hand.
   *
   * Runs from the scheduler, outside any request context, so this deliberately
   * spans tenants — it is not a tenant-scoped read. Each row carries its own
   * `tenantId`, which is what the downstream trigger uses for its queries and
   * its details upsert.
   */
  async findSessionsMissingActorEvaluation(params: {
    endedAfter: Date;
    endedBefore: Date;
    limit: number;
  }): Promise<ScenarioSessions[]> {
    return (
      this.createQueryBuilder('s')
        .leftJoin(ScenarioSessionDetails, 'd', 'd."scenarioSessionId" = s.id')
        .where('s.status = :status', {
          status: ScenarioSessionStatus.ENDED,
        })
        .andWhere('s.endedAt >= :endedAfter', { endedAfter: params.endedAfter })
        .andWhere('s.endedAt <= :endedBefore', {
          endedBefore: params.endedBefore,
        })
        .andWhere('d."evaluationStatus" IS NULL')
        // A session with no transcript has nothing to judge; the trigger would
        // skip it anyway, so filter here rather than spend a batch slot on it.
        .andWhere(
          `EXISTS (
           SELECT 1 FROM scenario_session_messages m
           WHERE m."scenarioSessionId" = s.id
         )`,
        )
        // Oldest first so a backlog drains in order instead of starving.
        .orderBy('s.endedAt', 'ASC')
        .limit(params.limit)
        .getMany()
    );
  }
}
