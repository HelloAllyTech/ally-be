import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GroupService } from 'src/authorization/service/group.service';
import {
  PLATFORM_TIER_ROLES,
  UserRole,
} from 'src/common/constants/user.constants';
import { HELPLINE_LIMITS } from '../constants/helpline.constants';
import { HelplineTenant, TeamMemberDto } from '../type/helpline.types';
import { badRequest } from '../util/helpline-errors';

interface TeamRow {
  id: number;
  name: string;
  email: string;
  isListener: boolean;
  isSupervisor: boolean;
  isAdmin: boolean;
}

/** Outside the caller's tenant, or Ally staff: indistinguishable from absent. */
const userNotFound = () => new NotFoundException('User not found');

/**
 * Helpline → Team (contract §5.3, `edit:helpline:team`): a tenant ADMIN grants
 * and revokes exactly two groups — LISTENER and HELPLINE_SUPERVISOR — for
 * users of their own tenant, and nothing else.
 *
 * Writes go through GroupService.assignRole / removeRole, which bust the
 * caller's `user:groups:` / `user:roles:` caches, so a new listener can open
 * the Helpline tab immediately instead of after the 30-minute cache lag.
 *
 * Ally staff accounts (any platform-tier role) are neither listed nor
 * editable here, even when their `tenant_id` is this tenant.
 */
@Injectable()
export class HelplineTeamService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly groupService: GroupService,
  ) {}

  async list(
    tenant: HelplineTenant,
    search?: string,
  ): Promise<{ items: TeamMemberDto[] }> {
    const rows = await this.query(tenant, { search });
    return { items: rows.map(toDto) };
  }

  async update(
    tenant: HelplineTenant,
    userId: number,
    body: { listener?: unknown; supervisor?: unknown },
  ): Promise<TeamMemberDto> {
    if (
      typeof body.listener !== 'boolean' ||
      typeof body.supervisor !== 'boolean'
    ) {
      throw badRequest('listener and supervisor must both be true or false');
    }
    const [current] = await this.query(tenant, { userId });
    if (!current) throw userNotFound();

    const changes: [UserRole, boolean, boolean][] = [
      [UserRole.LISTENER, current.isListener, body.listener],
      [UserRole.HELPLINE_SUPERVISOR, current.isSupervisor, body.supervisor],
    ];
    // Grants before revokes: removeRole refuses to take away a user's last
    // group, and swapping LISTENER for SUPERVISOR must not trip that.
    for (const [role, has, wants] of changes) {
      if (wants && !has) await this.groupService.assignRole({ role, userId });
    }
    for (const [role, has, wants] of changes) {
      if (!wants && has) await this.groupService.removeRole({ role, userId });
    }

    const [updated] = await this.query(tenant, { userId });
    if (!updated) throw userNotFound();
    return toDto(updated);
  }

  private async query(
    tenant: HelplineTenant,
    filter: { userId?: number; search?: string },
  ): Promise<TeamRow[]> {
    const params: unknown[] = [tenant.id, tenant.code, PLATFORM_TIER_ROLES];
    const conditions: string[] = [];
    if (filter.userId != null) {
      params.push(filter.userId);
      conditions.push(`u.id = $${params.length}`);
    }
    const search = filter.search?.trim();
    if (search) {
      params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      conditions.push(
        `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`,
      );
    }
    params.push(HELPLINE_LIMITS.TEAM_MAX_ITEMS);
    const rows: TeamRow[] = await this.dataSource.query(
      `SELECT u.id, u.name, u.email,
              COALESCE(bool_or(g.name = 'LISTENER'), false) AS "isListener",
              COALESCE(bool_or(g.name = 'HELPLINE_SUPERVISOR'), false) AS "isSupervisor",
              COALESCE(bool_or(g.name = 'ADMIN'), false) AS "isAdmin"
         FROM users u
         LEFT JOIN user_groups ug ON ug."userId" = u.id
         LEFT JOIN groups g ON g.id = ug."groupId"
        WHERE u.tenant_id IN ($1, $2) AND u.status = 'ACTIVE'
          ${conditions.map((c) => `AND ${c}`).join(' ')}
        GROUP BY u.id
       HAVING NOT COALESCE(bool_or(g.name = ANY($3::varchar[])), false)
        ORDER BY COALESCE(bool_or(g.name IN ('LISTENER','HELPLINE_SUPERVISOR')), false) DESC,
                 u.name ASC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  }
}

function toDto(row: TeamRow): TeamMemberDto {
  return {
    userId: Number(row.id),
    name: row.name,
    email: row.email,
    isListener: row.isListener === true,
    isSupervisor: row.isSupervisor === true,
    isAdmin: row.isAdmin === true,
  };
}
