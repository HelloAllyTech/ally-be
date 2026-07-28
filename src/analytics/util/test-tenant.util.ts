/**
 * The single answer to "whose data counts?" for analytics. Orgs flagged
 * `tenants.isTestOrganization` are internal/demo/QA tenants whose sessions,
 * users and AI spend would otherwise distort every platform metric, so all
 * super-admin analytics excludes them. New analytics queries MUST apply one of
 * these predicates.
 *
 * Three shapes, because the tenant linkage differs per table:
 *   - {@link excludeTestTenants}          the row carries a tenant column
 *   - {@link excludeTestTenantsBySession} reach it through scenario_sessions
 *   - {@link excludeTestTenantsByUser}    reach it through users
 *
 * All three are deliberately **parameter-free** SQL fragments so they drop into
 * the raw `$n`-positional queries (no placeholder renumbering) and into
 * `createQueryBuilder().andWhere(...)` alike. They are also **null-preserving**:
 * `NOT EXISTS` is true when the tenant reference is NULL, so deliberately
 * tenantless rows (most of `llm_usage` — judges, autofill, translation) survive
 * the filter instead of silently vanishing.
 *
 * Subquery aliases are prefixed `tt`/`tts`/`ttu` to avoid colliding with the
 * caller's aliases (`t` is already taken by the tenants join in
 * highlights-analytics.repository).
 */

/** Matches a tenant whose id-as-text OR code equals the given expression. */
function testTenantMatches(tenantRef: string): string {
  // scenario_sessions.tenant_id (and its copies) is a VARCHAR holding either a
  // tenant uuid or a tenant CODE like 'ally' in seed data, so both keys are
  // tried. The uuid side is cast to text — casting the varchar to uuid throws
  // on code values. Both sides are cast so the same fragment also serves the
  // uuid-typed track_enrollments."tenantId".
  return (
    `tt."isTestOrganization" = true ` +
    `AND (tt.id::text = (${tenantRef})::text OR tt.code = (${tenantRef})::text)`
  );
}

/**
 * Exclude rows belonging to a test org, for tables that carry a tenant column.
 * `tenantColumn` is the full column expression, e.g. `s."tenant_id"` or
 * `e."tenantId"`. Rows with a NULL tenant are KEPT.
 */
export function excludeTestTenants(tenantColumn: string): string {
  return (
    `NOT EXISTS (SELECT 1 FROM tenants tt ` +
    `WHERE ${testTenantMatches(tenantColumn)})`
  );
}

/**
 * Exclude rows belonging to a test org by walking the owning session — for
 * tables with no tenant column of their own (e.g.
 * scenario_session_lifecycle_events). `sessionIdColumn` is the full column
 * expression, e.g. `l."scenarioSessionId"`.
 */
export function excludeTestTenantsBySession(sessionIdColumn: string): string {
  return (
    `NOT EXISTS (SELECT 1 FROM scenario_sessions tts ` +
    `JOIN tenants tt ON (tt.id::text = tts."tenant_id" ` +
    `OR tt.code = tts."tenant_id") ` +
    `WHERE tts.id = ${sessionIdColumn} AND tt."isTestOrganization" = true)`
  );
}

/**
 * Exclude rows belonging to a test org's users by walking the owning user —
 * for tables with neither a tenant column nor a session (e.g.
 * track_quiz_attempts), and for tables whose own tenant column is nullable but
 * whose user is not (track_enrollments). `userIdColumn` is the full column
 * expression, e.g. `q."userId"`.
 */
export function excludeTestTenantsByUser(userIdColumn: string): string {
  return (
    `NOT EXISTS (SELECT 1 FROM users ttu ` +
    `JOIN tenants tt ON (tt.id::text = ttu."tenant_id" ` +
    `OR tt.code = ttu."tenant_id") ` +
    `WHERE ttu.id = ${userIdColumn} AND tt."isTestOrganization" = true)`
  );
}
