import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PLATFORM_TIER_ROLES } from 'src/common/constants/user.constants';
import { HELPLINE_TIMINGS } from '../constants/helpline.constants';
import { HelplineTenant } from '../type/helpline.types';

export interface HelplineStaffMember {
  id: number;
  name: string;
}

/**
 * "Who in this org holds permission X" — alert recipients
 * (`view:helpline:monitor`) and the monitor's listener roster
 * (`view:helpline:lobby`). A permission is a `groups` row joined through
 * `user_groups` → `group_permissions` → `permissions`, unioned across a user's
 * groups, never the collapsed `role`.
 *
 * Tenant-scoped on `users.tenant_id`, which may hold the tenant uuid OR its
 * code, so both are matched. Ally platform staff (any platform-tier group) are
 * excluded exactly as Helpline → Team excludes them: an Ally account parked in
 * a client tenant must not receive that client's helpline alerts.
 *
 * Cached in process for 5 minutes per (tenant, permission) — the same lag as
 * the permission cache a grant already waits on.
 */
@Injectable()
export class HelplineStaffDirectoryService {
  private readonly cache = new Map<
    string,
    { value: HelplineStaffMember[]; expires: number }
  >();

  constructor(private readonly dataSource: DataSource) {}

  async usersWithPermission(
    tenant: HelplineTenant,
    permission: string,
  ): Promise<HelplineStaffMember[]> {
    const key = `${tenant.id}:${permission}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const rows: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT u.id, u.name
           FROM users u
           JOIN user_groups ug ON ug."userId" = u.id
           JOIN groups g ON g.id = ug."groupId"
          WHERE u.tenant_id IN ($1, $2) AND u.status = 'ACTIVE'
          GROUP BY u.id, u.name
         HAVING bool_or(EXISTS (
                  SELECT 1 FROM group_permissions gp
                    JOIN permissions p ON p.id = gp."permissionId"
                   WHERE gp."groupId" = g.id AND p.name = $3))
            AND NOT bool_or(g.name = ANY($4::varchar[]))
          ORDER BY u.id`,
        [tenant.id, tenant.code, permission, PLATFORM_TIER_ROLES],
      );
    const value = rows.map((r) => ({ id: Number(r.id), name: r.name ?? '' }));
    this.cache.set(key, {
      value,
      expires: Date.now() + HELPLINE_TIMINGS.TENANT_CACHE_MS,
    });
    return value;
  }
}
