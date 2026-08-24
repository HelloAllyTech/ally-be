import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Filtered read-only views the Analytics Agent (src/analytics-agent/) reads
 * instead of these tables directly, so that whatever SQL an LLM planner writes
 * on top of them can never surface a row belonging to a tenant flagged
 * `tenants."isTestOrganization" = true` (Ally's own internal/demo/QA org).
 *
 * Every other analytics repository applies this exclusion per-query via
 * src/analytics/util/test-tenant.util.ts's excludeTestTenants[/BySession/ByUser].
 * The Analytics Agent can't use that pattern: the LLM's query shape isn't known
 * ahead of time, and it might never reference `tenants` at all. So the
 * predicate is baked into the relation itself instead. The three WHERE shapes
 * below are exactly the SQL those three helpers already run in production;
 * only the location moved.
 *
 * IMPORTANT: the physical `tenants` table is never itself replaced by a view
 * under its own name. Every predicate below — including
 * analytics_agent_tenants — joins against the REAL `tenants` table to check
 * "isTestOrganization". If `tenants` were ever shadowed by a same-named view,
 * every exclusion predicate in this codebase (not just the Analytics Agent's)
 * would silently become vacuously true, since there would be no test-tenant
 * row left to find.
 *
 * `CREATE OR REPLACE VIEW` (not bare CREATE) so this migration is safe to
 * re-run in a reset/reseed pipeline. Plain views, not materialized: they must
 * stay live as tenants are flagged/unflagged, never go stale pending a manual
 * REFRESH. `SELECT *` freezes each view's column list at creation time — a
 * later column added to a base table needs its view re-created in a follow-up
 * migration, or the Analytics Agent simply won't see the new column.
 */

/** Tables that carry their own tenant column. `column` is the exact SQL
 *  reference (quoted for camelCase columns, plain for snake_case ones —
 *  Postgres folds unquoted identifiers to lowercase, so plain is equivalent). */
const OWN_TENANT_COLUMN: { table: string; column: string }[] = [
  { table: 'users', column: 'tenant_id' },
  { table: 'admin_tenants', column: '"tenantId"' },
  { table: 'scenario_tenants', column: '"tenantId"' },
  { table: 'track_tenants', column: '"tenantId"' },
  { table: 'case_tenants', column: '"tenantId"' },
  { table: 'scenario_sessions', column: 'tenant_id' },
  { table: 'scenario_session_details', column: 'tenant_id' },
  { table: 'scenario_session_events', column: 'tenant_id' },
  { table: 'scenario_session_feedbacks', column: 'tenant_id' },
  { table: 'scenario_session_turn_metrics', column: 'tenant_id' },
  { table: 'scenario_session_start_metrics', column: 'tenant_id' },
  { table: 'scenario_session_reviews', column: 'tenant_id' },
  { table: 'chats', column: 'tenant_id' },
  { table: 'queue_entries', column: 'tenant_id' },
  { table: 'user_daily_scores', column: 'tenant_id' },
  // Nullable — most rows are tenantless (judges/autofill/translation). The
  // NOT EXISTS predicate is null-preserving by construction: id/code equality
  // never matches NULL, so those rows survive here too, same as today.
  { table: 'llm_usage', column: 'tenant_id' },
];

/** Tables with no tenant column of their own; reached via scenario_sessions. */
const VIA_SESSION: { table: string; column: string }[] = [
  { table: 'roleplay_rubric_scores', column: '"scenarioSessionId"' },
  { table: 'roleplay_director_events', column: '"scenarioSessionId"' },
];

/** Tables with neither a tenant nor a session column; reached via the acting
 *  user. `track_enrollments` has its own nullable `tenantId`, but — matching
 *  the existing repository precedent for this exact table — is routed through
 *  the user instead, since the column is not reliably populated. */
const VIA_USER: { table: string; column: string }[] = [
  { table: 'track_enrollments', column: '"userId"' },
  { table: 'track_item_progress', column: '"userId"' },
  { table: 'track_quiz_attempts', column: '"userId"' },
  { table: 'case_sessions', column: '"userId"' },
  { table: 'case_session_items', column: '"userId"' },
  { table: 'scenario_path_sessions', column: '"userId"' },
  { table: 'scenario_path_session_items', column: '"userId"' },
  { table: 'badge_users', column: '"userId"' },
  { table: 'user_groups', column: '"userId"' },
];

const ALL_TABLES = [
  'tenants',
  ...OWN_TENANT_COLUMN.map((t) => t.table),
  ...VIA_SESSION.map((t) => t.table),
  ...VIA_USER.map((t) => t.table),
];

const viewName = (table: string): string => `analytics_agent_${table}`;

export class CreateAnalyticsAgentTestTenantExclusionViews1932000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The one self-referential case: tenants filtering itself needs no join.
    await queryRunner.query(`
      CREATE OR REPLACE VIEW ${viewName('tenants')} AS
      SELECT * FROM tenants b WHERE NOT b."isTestOrganization"
    `);

    for (const { table, column } of OWN_TENANT_COLUMN) {
      await queryRunner.query(`
        CREATE OR REPLACE VIEW ${viewName(table)} AS
        SELECT b.* FROM ${table} b
        WHERE NOT EXISTS (
          SELECT 1 FROM tenants tt
          WHERE tt."isTestOrganization" = true
            AND (tt.id::text = (b.${column})::text OR tt.code = (b.${column})::text)
        )
      `);
    }

    for (const { table, column } of VIA_SESSION) {
      await queryRunner.query(`
        CREATE OR REPLACE VIEW ${viewName(table)} AS
        SELECT b.* FROM ${table} b
        WHERE NOT EXISTS (
          SELECT 1 FROM scenario_sessions tts
          JOIN tenants tt ON (tt.id::text = tts."tenant_id" OR tt.code = tts."tenant_id")
          WHERE tts.id = b.${column} AND tt."isTestOrganization" = true
        )
      `);
    }

    for (const { table, column } of VIA_USER) {
      await queryRunner.query(`
        CREATE OR REPLACE VIEW ${viewName(table)} AS
        SELECT b.* FROM ${table} b
        WHERE NOT EXISTS (
          SELECT 1 FROM users ttu
          JOIN tenants tt ON (tt.id::text = ttu."tenant_id" OR tt.code = ttu."tenant_id")
          WHERE ttu.id = b.${column} AND tt."isTestOrganization" = true
        )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ALL_TABLES) {
      await queryRunner.query(`DROP VIEW IF EXISTS ${viewName(table)}`);
    }
  }
}
