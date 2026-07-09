import { Injectable } from '@nestjs/common';
import { DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  ListRoleplaySessionLogsQueryDto,
  RoleplaySessionLogSortBy,
} from '../dto/roleplay-session-logs.dto';
import { SortOrder } from '../../common/type/common.type';

/** A flat list row as returned by the raw query (camelCase aliases). */
export interface RoleplaySessionLogRawRow {
  id: string;
  counselorId: number | string;
  counselorName: string | null;
  counselorEmail: string | null;
  tenantId: string;
  orgName: string | null;
  scenarioId: number | string;
  scenarioTitle: string | null;
  status: string;
  /** Derived session outcome (see RoleplaySessionOutcome). */
  outcome: string;
  startedAt: Date | null;
  endedAt: Date | null;
  score: number | string | null;
  platform: string | null;
  callDuration: number | string | null;
  totalPausedMs: number | string | null;
  createdAt: Date;
  /** True when this session was started by the super-admin V2V test tool. */
  isV2VTest: boolean;
  /** Detail-only enrichments (present on `findOne`, absent on `list`). */
  scenarioVersionId?: string | null;
  language?: string | null;
  voiceId?: string | null;
  compositeScore?: number | string | null;
  evalMetrics?: Record<string, number> | null;
  evaluationMarkdown?: string | null;
  evaluationStatus?: string | null;
  evaluatedAt?: Date | null;
}

/** One usage bucket for a session, grouped by (service, provider, model). */
export interface RoleplaySessionUsageRow {
  scenarioSessionId: string;
  service: string;
  provider: string;
  model: string;
  promptTokens: number | string;
  completionTokens: number | string;
  totalTokens: number | string;
  cachedTokens: number | string;
  audioMs: number | string;
  characters: number | string;
  calls: number | string;
}

/** Aggregated per-session voice-pipeline latency + quality (one row). */
export interface RoleplaySessionLatencyRow {
  turnCount: number | string;
  avgResponseLatencyMs: number | string | null;
  p50ResponseLatencyMs: number | string | null;
  p95ResponseLatencyMs: number | string | null;
  avgEouDelayMs: number | string | null;
  avgLlmTtftMs: number | string | null;
  avgTtsTtfbMs: number | string | null;
  avgOrchestrationMs: number | string | null;
  avgLlmResponseMs: number | string | null;
  avgProsodyMs: number | string | null;
  avgBranchingMs: number | string | null;
  avgKnowledgeRetrievalMs: number | string | null;
  avgProcessEventsMs: number | string | null;
  avgBehaviorsMs: number | string | null;
  interruptedTurns: number | string;
  llmTimedOutTurns: number | string;
  prosodySkippedTurns: number | string;
}

/**
 * Cross-tenant (platform-wide) reads of roleplay sessions for the super-admin
 * "Roleplay Session Logs" view. Uses a `DataSource`-backed query builder rather
 * than the tenant-scoped `ScenarioSessionRepository` because these queries span
 * `scenario_sessions`, `users`, `scenarios` and `tenants` and are deliberately
 * NOT scoped to a tenant — mirroring the super-admin analytics pattern in
 * {@link PlatformAnalyticsRepository}.
 *
 * Admin-Studio preview runs are never persisted (they only ever create
 * ephemeral `preview-*` LiveKit rooms), and local-dev seed fixtures use
 * `seed-room-*` room ids; both are excluded here so only genuine end-user
 * roleplays surface.
 */
@Injectable()
export class RoleplaySessionLogsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private static readonly SORT_COLUMNS: Record<
    RoleplaySessionLogSortBy,
    string
  > = {
    [RoleplaySessionLogSortBy.CREATED_AT]: 'ss."createdAt"',
    [RoleplaySessionLogSortBy.STARTED_AT]: 'ss."startedAt"',
    [RoleplaySessionLogSortBy.ENDED_AT]: 'ss."endedAt"',
    [RoleplaySessionLogSortBy.SCORE]: 'ss."score"',
    [RoleplaySessionLogSortBy.STATUS]: 'ss."status"',
  };

  /**
   * Derived per-session outcome, richer than the binary ACTIVE|ENDED status.
   * ACTIVE -> IN_PROGRESS; ENDED with >=1 transcript message -> COMPLETED;
   * ENDED with none -> NO_CONVERSATION (surfaces "agent never joined" / empty
   * sessions). A correlated EXISTS keeps it a per-row check. Both
   * scenario_session_messages."scenarioSessionId" and scenario_sessions.id are
   * uuid, so they are compared directly (a `::text` cast would raise
   * `operator does not exist: uuid = text`).
   */
  private static readonly OUTCOME_EXPR = `
    CASE
      WHEN ss."status" = 'ACTIVE' THEN 'IN_PROGRESS'
      WHEN EXISTS (
        SELECT 1 FROM scenario_session_messages ssm
        WHERE ssm."scenarioSessionId" = ss.id
      ) THEN 'COMPLETED'
      ELSE 'NO_CONVERSATION'
    END`;

  /**
   * Applies the shared filters (exclusions + user filters) to a query that has
   * already FROM `scenario_sessions ss` and joined `users u` + `scenarios scn`.
   * Kept in one place so the list query and the count query stay in lockstep.
   */
  private applyFilters(
    qb: SelectQueryBuilder<ObjectLiteral>,
    filters: ListRoleplaySessionLogsQueryDto,
  ): void {
    // Exclude non-user rows: Admin-Studio previews (never persisted, defensive)
    // and local-dev seed fixtures.
    qb.where(`ss."roomId" NOT LIKE 'preview-%'`).andWhere(
      `ss."roomId" NOT LIKE 'seed-room-%'`,
    );

    if (filters.status) {
      qb.andWhere('ss."status" = :status', { status: filters.status });
    }

    if (filters.tenantId) {
      qb.andWhere('ss."tenant_id" = :tenantId', { tenantId: filters.tenantId });
    }

    if (filters.search) {
      qb.andWhere(
        '(u."name" ILIKE :search OR u."email" ILIKE :search OR scn."title" ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (filters.dateFrom) {
      qb.andWhere(`COALESCE(ss."startedAt", ss."createdAt") >= :dateFrom`, {
        dateFrom: filters.dateFrom,
      });
    }

    if (filters.dateTo) {
      qb.andWhere(`COALESCE(ss."startedAt", ss."createdAt") <= :dateTo`, {
        dateTo: filters.dateTo,
      });
    }

    if (filters.isV2VTest === true) {
      qb.andWhere(`(ss.metadata->>'v2vTest')::boolean = true`);
    } else if (filters.isV2VTest === false) {
      qb.andWhere(
        `COALESCE((ss.metadata->>'v2vTest')::boolean, false) = false`,
      );
    }
  }

  /** Paginated, filtered, cross-tenant list of roleplay sessions + total count. */
  async list(
    filters: ListRoleplaySessionLogsQueryDto,
  ): Promise<{ rows: RoleplaySessionLogRawRow[]; total: number }> {
    const sortBy = filters.sortBy ?? RoleplaySessionLogSortBy.CREATED_AT;
    const order: 'ASC' | 'DESC' =
      filters.order === SortOrder.ASC ? 'ASC' : 'DESC';
    const limit = filters.limit ?? 25;
    const offset = filters.offset ?? 0;

    const dataQb = this.dataSource
      .createQueryBuilder()
      .select('ss."id"', 'id')
      .addSelect('ss."counselorId"', 'counselorId')
      .addSelect('u."name"', 'counselorName')
      .addSelect('u."email"', 'counselorEmail')
      .addSelect('ss."tenant_id"', 'tenantId')
      .addSelect('t."name"', 'orgName')
      .addSelect('ss."scenarioId"', 'scenarioId')
      .addSelect('scn."title"', 'scenarioTitle')
      .addSelect('ss."status"', 'status')
      .addSelect(RoleplaySessionLogsRepository.OUTCOME_EXPR, 'outcome')
      .addSelect('ss."startedAt"', 'startedAt')
      .addSelect('ss."endedAt"', 'endedAt')
      .addSelect('ss."score"', 'score')
      .addSelect(`ss.metadata->>'platform'`, 'platform')
      .addSelect('d."callDuration"', 'callDuration')
      .addSelect('ss."totalPausedMs"', 'totalPausedMs')
      .addSelect('ss."createdAt"', 'createdAt')
      .addSelect(
        `COALESCE((ss.metadata->>'v2vTest')::boolean, false)`,
        'isV2VTest',
      )
      .from('scenario_sessions', 'ss')
      .leftJoin('users', 'u', 'u.id = ss."counselorId"')
      .leftJoin('scenarios', 'scn', 'scn.id = ss."scenarioId"')
      // scenario_sessions.tenant_id is varchar (BaseEntity), tenants.id is uuid.
      // Compare as text so a non-uuid tenant_id (e.g. legacy/seed data) simply
      // fails to match instead of raising a cast error for the whole query.
      .leftJoin('tenants', 't', 't.id::text = ss."tenant_id"')
      .leftJoin(
        'scenario_session_details',
        'd',
        'd."scenarioSessionId"::uuid = ss.id',
      );

    this.applyFilters(dataQb, filters);

    dataQb
      .orderBy(
        RoleplaySessionLogsRepository.SORT_COLUMNS[sortBy],
        order,
        'NULLS LAST',
      )
      .addOrderBy('ss."id"', 'ASC')
      .limit(limit)
      .offset(offset);

    const rows = await dataQb.getRawMany<RoleplaySessionLogRawRow>();

    // Count query mirrors the same FROM/JOIN/WHERE (joins to users/scenarios are
    // needed because `search` filters on them); no select shaping or paging.
    const countQb = this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('scenario_sessions', 'ss')
      .leftJoin('users', 'u', 'u.id = ss."counselorId"')
      .leftJoin('scenarios', 'scn', 'scn.id = ss."scenarioId"');

    this.applyFilters(countQb, filters);

    const countRow = await countQb.getRawOne<{ count: number }>();

    return { rows, total: Number(countRow?.count) || 0 };
  }

  /** Single session core row (cross-tenant), or null when not found. */
  async findOne(id: string): Promise<RoleplaySessionLogRawRow | null> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('ss."id"', 'id')
      .addSelect('ss."counselorId"', 'counselorId')
      .addSelect('u."name"', 'counselorName')
      .addSelect('u."email"', 'counselorEmail')
      .addSelect('ss."tenant_id"', 'tenantId')
      .addSelect('t."name"', 'orgName')
      .addSelect('ss."scenarioId"', 'scenarioId')
      .addSelect('scn."title"', 'scenarioTitle')
      .addSelect('ss."status"', 'status')
      .addSelect(RoleplaySessionLogsRepository.OUTCOME_EXPR, 'outcome')
      .addSelect('ss."startedAt"', 'startedAt')
      .addSelect('ss."endedAt"', 'endedAt')
      .addSelect('ss."score"', 'score')
      .addSelect(`ss.metadata->>'platform'`, 'platform')
      .addSelect('d."callDuration"', 'callDuration')
      .addSelect('ss."totalPausedMs"', 'totalPausedMs')
      .addSelect('ss."createdAt"', 'createdAt')
      .addSelect(
        `COALESCE((ss.metadata->>'v2vTest')::boolean, false)`,
        'isV2VTest',
      )
      .addSelect('ss."scenarioVersionId"', 'scenarioVersionId')
      .addSelect(`COALESCE(lang."label", lang."value")`, 'language')
      .addSelect(`ss.metadata->>'voiceId'`, 'voiceId')
      .addSelect('d."compositeScore"', 'compositeScore')
      .addSelect('d."metrics"', 'evalMetrics')
      .addSelect('d."evaluationMarkdown"', 'evaluationMarkdown')
      .addSelect('d."evaluationStatus"', 'evaluationStatus')
      .addSelect('d."evaluatedAt"', 'evaluatedAt')
      .from('scenario_sessions', 'ss')
      .leftJoin('users', 'u', 'u.id = ss."counselorId"')
      .leftJoin('scenarios', 'scn', 'scn.id = ss."scenarioId"')
      // scenario_sessions.tenant_id is varchar (BaseEntity), tenants.id is uuid.
      // Compare as text so a non-uuid tenant_id (e.g. legacy/seed data) simply
      // fails to match instead of raising a cast error for the whole query.
      .leftJoin('tenants', 't', 't.id::text = ss."tenant_id"')
      .leftJoin(
        'scenario_session_details',
        'd',
        'd."scenarioSessionId"::uuid = ss.id',
      )
      // Resolve the session's configured language id (metadata) to a label.
      .leftJoin(
        'languages',
        'lang',
        `lang.id = NULLIF(ss.metadata->>'languageId', '')::int`,
      )
      .where('ss.id = :id', { id })
      .getRawOne<RoleplaySessionLogRawRow>();

    return row ?? null;
  }

  /** Post-session summary jsonb for a session, if any. */
  async findSummary(id: string): Promise<Record<string, any> | null> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('d."summary"', 'summary')
      .from('scenario_session_details', 'd')
      .where('d."scenarioSessionId"::uuid = :id', { id })
      .getRawOne<{ summary: Record<string, any> | null }>();

    return row?.summary ?? null;
  }

  /** Scored/triggered events for a session, oldest first, with the event name. */
  async findEvents(id: string): Promise<
    Array<{
      id: string;
      eventId: string;
      eventName: string | null;
      occurredAt: Date;
      score: number | string | null;
      emoji: string | null;
      message: string | null;
    }>
  > {
    return this.dataSource
      .createQueryBuilder()
      .select('e."id"', 'id')
      .addSelect('e."eventId"', 'eventId')
      .addSelect('se."name"', 'eventName')
      .addSelect('e."occurredAt"', 'occurredAt')
      .addSelect('e."score"', 'score')
      .addSelect('e."emoji"', 'emoji')
      .addSelect('e."message"', 'message')
      .from('scenario_session_events', 'e')
      .leftJoin('session_events', 'se', 'se.id = e."eventId"')
      .where('e."scenarioSessionId"::uuid = :id', { id })
      .andWhere('e."autoTerminationStatus" = false')
      .orderBy('e."occurredAt"', 'ASC')
      .getRawMany();
  }

  /**
   * Infrastructure lifecycle timeline for a session, oldest first (room
   * created, agent dispatched/joined, participant joined, recording started,
   * room finished). Powers the session-detail timeline; an absent AGENT_JOINED
   * row is the "agent never joined" signal.
   */
  async findLifecycleEvents(id: string): Promise<
    Array<{
      id: string;
      type: string;
      occurredAt: Date;
      detail: Record<string, any> | null;
    }>
  > {
    return this.dataSource
      .createQueryBuilder()
      .select('l."id"', 'id')
      .addSelect('l."type"', 'type')
      .addSelect('l."occurredAt"', 'occurredAt')
      .addSelect('l."detail"', 'detail')
      .from('scenario_session_lifecycle_events', 'l')
      .where('l."scenarioSessionId" = :id', { id })
      .orderBy('l."occurredAt"', 'ASC')
      .addOrderBy('l."createdAt"', 'ASC')
      .getRawMany();
  }

  /** Transcript turns for a session, ordered by playback position then time. */
  async findTranscript(id: string): Promise<
    Array<{
      id: number;
      senderId: number;
      content: string;
      startSeconds: number | null;
      endSeconds: number | null;
      createdAt: Date;
    }>
  > {
    return this.dataSource
      .createQueryBuilder()
      .select('m."id"', 'id')
      .addSelect('m."senderId"', 'senderId')
      .addSelect('m."content"', 'content')
      .addSelect('m."startSeconds"', 'startSeconds')
      .addSelect('m."endSeconds"', 'endSeconds')
      .addSelect('m."createdAt"', 'createdAt')
      .from('scenario_session_messages', 'm')
      .where('m."scenarioSessionId" = :id', { id })
      .orderBy('m."startSeconds"', 'ASC', 'NULLS LAST')
      .addOrderBy('m."createdAt"', 'ASC')
      .getRawMany();
  }

  /**
   * AI usage for one or more sessions, grouped by (session, service, provider,
   * model). Mirrors {@link LlmUsageRepository.getTokenUsageByModelAndTask} but
   * keyed per session via the `scenarioSessionId` correlation column. The
   * service prices these rows (LLM/STT/TTS) and rolls them up. Returns [] for an
   * empty id list (TypeORM's `IN (:...ids)` rejects an empty array).
   */
  async getUsageBySessions(ids: string[]): Promise<RoleplaySessionUsageRow[]> {
    if (ids.length === 0) return [];
    return this.dataSource
      .createQueryBuilder()
      .select('lu."scenarioSessionId"', 'scenarioSessionId')
      .addSelect('lu.service', 'service')
      .addSelect('lu.provider', 'provider')
      .addSelect('lu.model', 'model')
      .addSelect('COALESCE(SUM(lu."promptTokens"), 0)::bigint', 'promptTokens')
      .addSelect(
        'COALESCE(SUM(lu."completionTokens"), 0)::bigint',
        'completionTokens',
      )
      .addSelect('COALESCE(SUM(lu."totalTokens"), 0)::bigint', 'totalTokens')
      .addSelect('COALESCE(SUM(lu."cachedTokens"), 0)::bigint', 'cachedTokens')
      .addSelect('COALESCE(SUM(lu."audioMs"), 0)::bigint', 'audioMs')
      .addSelect('COALESCE(SUM(lu."characters"), 0)::bigint', 'characters')
      .addSelect('COUNT(*)::int', 'calls')
      .from('llm_usage', 'lu')
      .where('lu."scenarioSessionId" IN (:...ids)', { ids })
      .groupBy('lu."scenarioSessionId"')
      .addGroupBy('lu.service')
      .addGroupBy('lu.provider')
      .addGroupBy('lu.model')
      .getRawMany<RoleplaySessionUsageRow>();
  }

  /** Convenience: usage buckets for a single session. */
  async getUsageBySession(id: string): Promise<RoleplaySessionUsageRow[]> {
    return this.getUsageBySessions([id]);
  }

  /**
   * Per-session voice-pipeline latency + quality, aggregated over
   * `scenario_session_turn_metrics` (source='pipeline' only — never mix the
   * transcript-derived estimates). Mirrors the percentile pattern in
   * {@link PlatformAnalyticsRepository.getVoiceLatencyByBucket}. Always returns
   * one row; `turnCount` is 0 when the session has no pipeline turns.
   */
  async getLatencyBySession(id: string): Promise<RoleplaySessionLatencyRow> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'turnCount')
      .addSelect(
        'round(avg(m."responseLatencyMs"))::int',
        'avgResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p50ResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p95ResponseLatencyMs',
      )
      .addSelect('round(avg(m."eouDelayMs"))::int', 'avgEouDelayMs')
      .addSelect('round(avg(m."llmTtftMs"))::int', 'avgLlmTtftMs')
      .addSelect('round(avg(m."ttsTtfbMs"))::int', 'avgTtsTtfbMs')
      .addSelect('round(avg(m."orchestrationMs"))::int', 'avgOrchestrationMs')
      .addSelect('round(avg(m."llmResponseMs"))::int', 'avgLlmResponseMs')
      .addSelect('round(avg(m."prosodyMs"))::int', 'avgProsodyMs')
      .addSelect('round(avg(m."branchingMs"))::int', 'avgBranchingMs')
      .addSelect(
        'round(avg(m."knowledgeRetrievalMs"))::int',
        'avgKnowledgeRetrievalMs',
      )
      .addSelect('round(avg(m."processEventsMs"))::int', 'avgProcessEventsMs')
      .addSelect('round(avg(m."behaviorsMs"))::int', 'avgBehaviorsMs')
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."interrupted" THEN 1 ELSE 0 END), 0)::int',
        'interruptedTurns',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."llmTimedOut" THEN 1 ELSE 0 END), 0)::int',
        'llmTimedOutTurns',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."prosodySkipped" THEN 1 ELSE 0 END), 0)::int',
        'prosodySkippedTurns',
      )
      .from('scenario_session_turn_metrics', 'm')
      .where('m."scenarioSessionId" = :id', { id })
      .andWhere(`m."source" = 'pipeline'`)
      .getRawOne<RoleplaySessionLatencyRow>();

    // getRawOne over an aggregate always returns a row; fall back defensively.
    return (
      row ?? {
        turnCount: 0,
        avgResponseLatencyMs: null,
        p50ResponseLatencyMs: null,
        p95ResponseLatencyMs: null,
        avgEouDelayMs: null,
        avgLlmTtftMs: null,
        avgTtsTtfbMs: null,
        avgOrchestrationMs: null,
        avgLlmResponseMs: null,
        avgProsodyMs: null,
        avgBranchingMs: null,
        avgKnowledgeRetrievalMs: null,
        avgProcessEventsMs: null,
        avgBehaviorsMs: null,
        interruptedTurns: 0,
        llmTimedOutTurns: 0,
        prosodySkippedTurns: 0,
      }
    );
  }

  /** LiveKit egress recording pointer for a session, if one exists. */
  async getRecordingBySession(
    id: string,
  ): Promise<{ storageKey: string; egressId: string } | null> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('r."storageKey"', 'storageKey')
      .addSelect('r."egressId"', 'egressId')
      .from('scenario_session_recordings', 'r')
      .where('r."scenarioSessionId" = :id', { id })
      .getRawOne<{ storageKey: string; egressId: string }>();

    return row ?? null;
  }

  /**
   * All superadmin-configured agent test cases (global; not tenant-scoped).
   * These are the rubric the roleplay actor is scored against, shown alongside
   * the per-session evaluation.
   */
  async findAgentTestCases(): Promise<
    Array<{
      id: string;
      title: string;
      category: string;
      description: string | null;
    }>
  > {
    return this.dataSource
      .createQueryBuilder()
      .select('g."id"', 'id')
      .addSelect('g."title"', 'title')
      .addSelect('g."category"', 'category')
      .addSelect('g."description"', 'description')
      .from('agent_test_cases', 'g')
      .orderBy('g."category"', 'ASC')
      .addOrderBy('g."title"', 'ASC')
      .getRawMany();
  }

  /** Most recent post-session learner feedback for a session, if any. */
  async getFeedbackBySession(id: string): Promise<{
    rating: number | string;
    feedback: string | null;
    tags: string[] | null;
  } | null> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('f."rating"', 'rating')
      .addSelect('f."feedback"', 'feedback')
      .addSelect('f."tags"', 'tags')
      .from('scenario_session_feedbacks', 'f')
      .where('f."scenarioSessionId" = :id', { id })
      .orderBy('f."createdAt"', 'DESC')
      .limit(1)
      .getRawOne<{
        rating: number | string;
        feedback: string | null;
        tags: string[] | null;
      }>();

    return row ?? null;
  }
}
