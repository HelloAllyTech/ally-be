import { DataSource } from 'typeorm';

import { excludeTestTenants } from './test-tenant.util';
import { startOfUtcDay } from './analytics-window.util';

/**
 * The platform's first row — where an all-time analytics window starts.
 *
 * `range=all` cannot be resolved from the calendar alone: "all time" is a fact
 * about the data, not about today's date. The alternative was a hard-coded epoch
 * constant, which would put an invented history on the left of every axis (and
 * quietly drift out of date). So the floor is measured.
 *
 * Two tables, not all of them: `users` because nothing on the platform predates
 * its first account, and `scenario_sessions` as a belt-and-braces lower bound in
 * case a seeded or migrated session does. Every other analytics source
 * (evaluations, feedback, AI usage, enrollments) hangs off a user and a session,
 * so it cannot start earlier. Test orgs are excluded, matching every aggregate
 * on these surfaces — otherwise a seed row from years ago would prepend a run of
 * empty buckets to charts that have no data there.
 *
 * Returns today (UTC day start) when the platform is empty. An empty window over
 * an empty platform is the honest answer; it renders as the designed empty state
 * rather than as an axis stretching back to 1970.
 */
export async function getPlatformDataFloor(
  dataSource: DataSource,
): Promise<Date> {
  const rows = await dataSource.query(
    `
    SELECT LEAST(
      (SELECT MIN(u."createdAt") FROM users u
        WHERE ${excludeTestTenants('u."tenant_id"')}),
      (SELECT MIN(s."createdAt") FROM scenario_sessions s
        WHERE ${excludeTestTenants('s."tenant_id"')})
    ) AS floor
    `,
  );
  const floor = (rows[0] as { floor: Date | string | null } | undefined)?.floor;
  if (!floor) return startOfUtcDay(new Date());

  const parsed = floor instanceof Date ? floor : new Date(floor);
  if (Number.isNaN(parsed.getTime())) return startOfUtcDay(new Date());
  return startOfUtcDay(parsed);
}
