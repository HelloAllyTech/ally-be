import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { TenantCohortMember } from '../entity/tenant-cohort-member.entity';
import { UNASSIGNED_COHORT_ID } from '../constants/cohort.constants';

/**
 * Platform-tier accounts are hidden from a tenant's own user list, matching what
 * `UserRepository.getAllUsers` does by default: this is a customer looking at
 * their people, and Ally staff accounts that happen to sit in their tenant are
 * not theirs to organise. Unlike the user-management screen there is no opt-in
 * flag — a tenant admin has no legitimate reason to cohort an internal account.
 *
 * Lists all five tier names, not just the live PLATFORM_ADMIN: the role-collapse
 * migration deliberately left the retired groups in place for rollback safety,
 * so an account still carrying one is still a staff account.
 */
const PLATFORM_ROLE_EXCLUSION_SQL = `NOT EXISTS (
  SELECT 1 FROM user_groups ug_excl
   INNER JOIN groups g_excl ON g_excl.id = ug_excl."groupId"
   WHERE ug_excl."userId" = u.id
     AND g_excl.name IN ('PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN', 'MULTI_TENANT_ADMIN')
)`;

export interface CohortMemberRow {
  userId: number;
  name: string;
  email: string;
  status: string;
  cohortId: string | null;
  cohortName: string | null;
}

@Injectable()
export class TenantCohortMemberRepository extends Repository<TenantCohortMember> {
  constructor(private dataSource: DataSource) {
    super(TenantCohortMember, dataSource.createEntityManager());
  }

  async findLiveForUsers(userIds: number[]): Promise<TenantCohortMember[]> {
    if (userIds.length === 0) return [];
    return this.find({
      where: { userId: In(userIds), deletedAt: IsNull() },
    });
  }

  async findLiveForUser(userId: number): Promise<TenantCohortMember | null> {
    return this.findOne({ where: { userId, deletedAt: IsNull() } });
  }

  /**
   * The tenant's users with their current cohort — the list the Cohorts tab
   * paginates through.
   *
   * Built as a raw query over `users` rather than through the User entity for
   * two reasons. First, `users.tenant_id` is a snake-cased *varchar* (it predates
   * uuid tenant ids) while every cohort table uses a uuid `tenantId`; keeping the
   * comparison as a plain varchar-to-parameter match avoids a cast, and avoids
   * the `::uuid` cast that would throw on any legacy non-uuid tenant code still
   * sitting in that column.
   *
   * Second, it selects only id/name/email/status. This endpoint is reachable by a
   * tenant ADMIN under `view:cohorts`, deliberately *without* granting them
   * `view:users` and the platform-wide user-management payload that comes with
   * it; a narrow projection is what makes that split honest rather than cosmetic.
   */
  async listTenantUsersWithCohort(options: {
    tenantId: string;
    search?: string;
    /** A cohort id, the UNASSIGNED sentinel, or undefined for no filter. */
    cohortId?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: CohortMemberRow[]; count: number }> {
    const params: unknown[] = [options.tenantId];
    const conditions = ['u.tenant_id = $1', PLATFORM_ROLE_EXCLUSION_SQL];

    if (options.search?.trim()) {
      params.push(`%${options.search.trim()}%`);
      conditions.push(
        `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`,
      );
    }

    if (options.cohortId === UNASSIGNED_COHORT_ID) {
      conditions.push('m.id IS NULL');
    } else if (options.cohortId) {
      params.push(options.cohortId);
      conditions.push(`m."cohortId" = $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const from = `
      FROM users u
      LEFT JOIN tenant_cohort_members m
        ON m."userId" = u.id AND m."deletedAt" IS NULL
      LEFT JOIN tenant_cohorts c
        ON c.id = m."cohortId" AND c."deletedAt" IS NULL
      WHERE ${where}`;

    const countRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count ${from}`,
      params,
    );

    const pageParams = [...params, options.limit, options.offset];
    const rows = await this.dataSource.query(
      `SELECT u.id AS "userId", u.name, u.email, u.status,
              m."cohortId" AS "cohortId", c.name AS "cohortName"
         ${from}
        ORDER BY u.name ASC, u.id ASC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );

    return {
      rows: rows as CohortMemberRow[],
      count: countRows?.[0]?.count ?? 0,
    };
  }

  /**
   * Which of these user ids actually belong to the tenant. Used to reject a move
   * that names a user from another tenant before any write happens — the scope
   * guard pins the *tenant*, not the user list inside the body.
   */
  async filterUserIdsInTenant(
    userIds: number[],
    tenantId: string,
  ): Promise<number[]> {
    if (userIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `SELECT id FROM users u
        WHERE u.tenant_id = $1
          AND u.id = ANY($2::int[])
          AND ${PLATFORM_ROLE_EXCLUSION_SQL}`,
      [tenantId, userIds],
    );
    return (rows as Array<{ id: number }>).map((r) => r.id);
  }

  /**
   * The tenant's cohortable users, counted regardless of cohort — the
   * denominator behind "12 of 48 users placed".
   *
   * Applies the same platform-role exclusion as the list, so the two agree. A
   * denominator that silently counted staff accounts the admin cannot see would
   * make a complete partition read as permanently incomplete.
   */
  async countTenantUsers(tenantId: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM users u
        WHERE u.tenant_id = $1 AND ${PLATFORM_ROLE_EXCLUSION_SQL}`,
      [tenantId],
    );
    return rows?.[0]?.count ?? 0;
  }
}
