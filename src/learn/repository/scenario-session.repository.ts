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
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import {
  BEHAVIOR_INSTRUCTION_SHOULD_DO_SCORE,
  BEHAVIOR_INSTRUCTION_SHOULD_NOT_DO_SCORE,
} from '../constants/scenario-behavior-instuctions.constants';

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
   * Sessions stuck at ACTIVE long past any plausible session length — the input
   * to the stuck-session sweeper.
   *
   * These used to sit at ACTIVE forever. Nothing ends a session except the
   * learner's End button, the agent's `end-of-session` message, or the
   * `room_finished` webhook, and all three can be lost at once: an agent that
   * never joins publishes nothing, a learner who closes their laptop clicks
   * nothing, and if LiveKit never created the room there is no webhook either.
   * The row then stays ACTIVE indefinitely, which makes it count against the
   * tenant's concurrent-simulation ceiling and read, on every operational view,
   * as a roleplay still in progress days later.
   *
   * A row that never began is IN SCOPE, aged by `createdAt`. This used to be
   * excluded on the reasoning that "a row with no `startedAt` never began, so
   * its age says nothing about whether it is stuck", and that reasoning had the
   * blind spot backwards. `startedAt` is written from exactly one place —
   * `participant-joined.handler`, and only for a non-AGENT participant — so a
   * start where the learner's own client never made it into the room leaves the
   * row ACTIVE with `startedAt` NULL forever. Nothing can ever set it later: the
   * room is gone, and LiveKit's empty-timeout never fires it either, because the
   * proactively-dispatched agent is in the room keeping it non-empty, so no
   * `room_finished` webhook arrives to end the session. That row then blocks the
   * learner out of the product entirely — `validateStartScenarioSession` refuses
   * any new start while ANY ACTIVE row exists for them — and it was the one
   * shape of stuck row this sweep could never see.
   *
   * The same six-hour margin covers it, and must: `startedAt` NULL is also what
   * a genuinely live session looks like when its participant-joined webhook was
   * merely lost, and reaping one of those mid-roleplay is the outcome
   * `STUCK_SESSION_AGE_MS` exists to make impossible. `createdAt` is only ever
   * EARLIER than the `startedAt` it stands in for, so nothing that used to be
   * out of scope moves in ahead of its old cutoff.
   *
   * Preview and seeded rooms are excluded, matching `countableSessionPredicate`.
   *
   * Runs from the scheduler, outside any request context, so this deliberately
   * spans tenants — it is not a tenant-scoped read.
   */
  async findSessionsStuckActive(params: {
    /**
     * Cutoff for the row's ACTIVE age: `startedAt` where the session started,
     * else `createdAt`.
     */
    activeBefore: Date;
    limit: number;
  }): Promise<ScenarioSessions[]> {
    return (
      this.createQueryBuilder('session')
        .where('session.status = :status', {
          status: ScenarioSessionStatus.ACTIVE,
        })
        // `scenario_sessions_active_started_idx` (partial on status = 'ACTIVE')
        // is still the access path: the live set it indexes is a tiny fraction
        // of the table, so the coalesced age applies as a filter over it.
        .andWhere(
          'COALESCE(session.startedAt, session.createdAt) < :activeBefore',
          { activeBefore: params.activeBefore },
        )
        .andWhere("session.roomId NOT LIKE 'preview-%'")
        .andWhere("session.roomId NOT LIKE 'seed-room-%'")
        // Oldest first: if the limit bites, the most stuck rows are cleared first
        // and the rest are picked up on the next tick. Coalesced for the same
        // reason as the cutoff — ordering on `startedAt` alone would sort every
        // never-started row last (ASC is NULLS LAST) and starve exactly the rows
        // that block a learner.
        .orderBy('COALESCE(session.startedAt, session.createdAt)', 'ASC')
        .limit(params.limit)
        .getMany()
    );
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
  /**
   * Sessions that reached a terminal `ENDED` but never had their post-session
   * lifecycle completed — the input to the unfinalised-session sweep.
   *
   * `eventStatus = IN_PROGRESS` on an ENDED row means exactly one thing: the
   * agent's `end-of-session` SQS message — the only writer of the score,
   * COMPLETED, the progression handoff and the leaderboard minutes — never got
   * to do its work. Either it was never sent (agent died before finalize), it
   * was dropped, or it was consumed while a bug made the handler bail out.
   * ABANDONED is excluded by the same predicate: those rows were deliberately
   * labelled and must not be quietly relabelled COMPLETED.
   *
   * `endedAt` bounded on both sides: `endedBefore` is the grace period that
   * keeps the sweep from racing a session that is ending right now, and
   * `endedAfter` bounds how far back a background task is allowed to restate
   * analytics (see UNFINALISED_SESSION_LOOKBACK_MS).
   *
   * Preview and seeded rooms are excluded, matching `findSessionsStuckActive`:
   * neither has a learner whose progress or practice minutes are owed.
   *
   * Runs from the scheduler, outside any request context, so this deliberately
   * spans tenants — it is not a tenant-scoped read. Each row carries its own
   * `tenantId`, which is what the downstream writes use.
   */
  async findEndedSessionsMissingFinalisation(params: {
    endedAfter: Date;
    endedBefore: Date;
    limit: number;
  }): Promise<ScenarioSessions[]> {
    return (
      this.createQueryBuilder('session')
        .where('session.status = :status', {
          status: ScenarioSessionStatus.ENDED,
        })
        .andWhere('session.eventStatus = :eventStatus', {
          eventStatus: ScenarioSessionEventStatus.IN_PROGRESS,
        })
        .andWhere('session.endedAt IS NOT NULL')
        .andWhere('session.endedAt >= :endedAfter', {
          endedAfter: params.endedAfter,
        })
        .andWhere('session.endedAt <= :endedBefore', {
          endedBefore: params.endedBefore,
        })
        .andWhere("session.roomId NOT LIKE 'preview-%'")
        .andWhere("session.roomId NOT LIKE 'seed-room-%'")
        // Oldest first: a learner waiting longest on a locked track item is the
        // one served first, and a bitten limit drains in order on the next tick.
        .orderBy('session.endedAt', 'ASC')
        .limit(params.limit)
        .getMany()
    );
  }
  /**
   * Sum the scored detections we persisted for these sessions — a DIAGNOSTIC
   * for a session whose `end-of-session` message went missing, not a substitute
   * for the score it carried.
   *
   * The agent's `totalScore` is `ScoreKeeper.get_total_score()`: every event it
   * sent us (persisted per detection into `scenario_session_events.score`) plus
   * every behaviour instruction it detected (persisted into
   * `scenario_session_behavior_instructions`, whose score is a constant per
   * category — see `formatBehaviorInstructionsForLivekitMetadata`, which is
   * where the agent read it from). So this is the same arithmetic over the same
   * rows, and it lands close.
   *
   * BUT IT IS NOT THE SAME NUMBER, and must never be written into
   * `scenario_sessions.score`. Two known divergences, both in the direction of
   * overcounting:
   *
   *  - A termination event outside the scenario's `trigger_events` is still
   *    sent to us, with its score, but ScoreKeeper deliberately excludes it
   *    (`_calculate_total_score_from_events` filters on `trigger_events`).
   *    Nothing we store records which events were trigger events, so we cannot
   *    subtract it back out.
   *  - A detection whose own message was lost is invisible here, which cuts the
   *    other way.
   *
   * A learner's score is not the place for a number that is nearly right, so
   * callers log this to give a human something to work from and leave the
   * column NULL, which every surface already renders as "--".
   *
   * Runs from the scheduler, outside any request context, so this deliberately
   * spans tenants. Keyed by session id, which is a uuid and unique across them.
   * A session with no scored detections at all is absent from the map rather
   * than present as zero.
   */
  async sumDetectionScores(
    scenarioSessionIds: string[],
  ): Promise<Map<string, number>> {
    if (!scenarioSessionIds.length) return new Map();

    const rows: Array<{ sid: string; total: string | number }> =
      await this.query(
        `SELECT sid, SUM(points)::int AS total
           FROM (
             SELECT e."scenarioSessionId" AS sid,
                    COALESCE(SUM(COALESCE(e.score, 0)), 0) AS points
               FROM scenario_session_events e
              WHERE e."scenarioSessionId" = ANY($1::uuid[])
              GROUP BY e."scenarioSessionId"
             UNION ALL
             SELECT sb."scenarioSessionId" AS sid,
                    -- The ::int casts are required, not decorative: an
                    -- untyped bound parameter arrives as text, and SUM(text)
                    -- is not a function that exists.
                    SUM(CASE WHEN bi.category = $2 THEN $3::int ELSE $4::int END)
                      AS points
               FROM scenario_session_behavior_instructions sb
               JOIN scenario_behavior_instructions bi
                 -- bi.id is uuid but the detection row stores it as varchar,
                 -- so this join needs the cast spelled out (Postgres has no
                 -- uuid = varchar operator). Cast the uuid side: the varchar
                 -- column is not guaranteed to hold well-formed uuids, and
                 -- casting it the other way would throw on the first bad row
                 -- instead of just not matching it.
                 ON bi.id::text = sb."scenarioBehaviorInstructionId"
              WHERE sb."scenarioSessionId" = ANY($1::uuid[])
              GROUP BY sb."scenarioSessionId"
           ) parts
          GROUP BY sid`,
        [
          scenarioSessionIds,
          BehaviorInstructionCategory.SHOULD_DO,
          BEHAVIOR_INSTRUCTION_SHOULD_DO_SCORE,
          BEHAVIOR_INSTRUCTION_SHOULD_NOT_DO_SCORE,
        ],
      );

    return new Map(rows.map((row) => [row.sid, Number(row.total)]));
  }
}
