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
  startedAt: Date | null;
  endedAt: Date | null;
  score: number | string | null;
  platform: string | null;
  callDuration: number | string | null;
  totalPausedMs: number | string | null;
  createdAt: Date;
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
      .addSelect('ss."startedAt"', 'startedAt')
      .addSelect('ss."endedAt"', 'endedAt')
      .addSelect('ss."score"', 'score')
      .addSelect(`ss.metadata->>'platform'`, 'platform')
      .addSelect('d."callDuration"', 'callDuration')
      .addSelect('ss."totalPausedMs"', 'totalPausedMs')
      .addSelect('ss."createdAt"', 'createdAt')
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
      .addSelect('ss."startedAt"', 'startedAt')
      .addSelect('ss."endedAt"', 'endedAt')
      .addSelect('ss."score"', 'score')
      .addSelect(`ss.metadata->>'platform'`, 'platform')
      .addSelect('d."callDuration"', 'callDuration')
      .addSelect('ss."totalPausedMs"', 'totalPausedMs')
      .addSelect('ss."createdAt"', 'createdAt')
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
}
