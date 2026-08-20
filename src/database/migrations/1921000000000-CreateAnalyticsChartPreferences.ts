import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-user, per-chart saved window and grain for the analytics dashboards.
 *
 * The Highlights tab deliberately has no page-level date range — each chart owns
 * its own window and grain — and without persistence that choice resets on every
 * visit. One row per (user, chart).
 *
 * `chartId`, `range` and `bucket` are opaque varchars rather than enums or
 * foreign keys: the client owns the chart catalogue, so renaming, splitting or
 * retiring a chart must not require a migration. A stale row for a chart that no
 * longer exists is harmless and ignored on read.
 *
 * No `tenant_id`. A UI preference belongs to a person, not an org, and these are
 * platform-wide super-admin views — scoping it by tenant would drop an admin's
 * saved layout the moment they changed the tenant filter.
 */
export class CreateAnalyticsChartPreferences1921000000000 implements MigrationInterface {
  name = 'CreateAnalyticsChartPreferences1921000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "analytics_chart_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "userId" integer NOT NULL,
        "chartId" character varying(128) NOT NULL,
        "range" character varying(32),
        "bucket" character varying(32),
        CONSTRAINT "PK_analytics_chart_preferences" PRIMARY KEY ("id")
      )
    `);

    // The upsert target: saving a chart's controls is an idempotent write of the
    // one row that owns them, not an append to a history nobody reads.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics_chart_preferences_user_chart_uq"
        ON "analytics_chart_preferences" ("userId", "chartId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "analytics_chart_preferences_user_chart_uq"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "analytics_chart_preferences"
    `);
  }
}
