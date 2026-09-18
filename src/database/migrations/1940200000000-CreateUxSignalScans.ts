import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The UX Signals scan log — one row per attempt to read PostHog and file what it
 * found.
 *
 * Why a table rather than logs: the row does three jobs no log line can.
 *
 *  - **It is the cadence.** The shared scheduler ticks 5min/15min/30min/hourly/
 *    monthly and has no daily interval, so the hourly task self-gates on the
 *    newest non-running row's `started_at`. That has to be durable — an in-memory
 *    marker would let every redeploy re-scan, which on a daily-cadence pipeline
 *    means a deploy-driven flood into two human review queues.
 *  - **It is the concurrency guard.** A RUNNING row younger than the staleness
 *    cutoff blocks a second scan, so the hourly tick cannot overlap a slow PostHog
 *    query or a manual "Scan now".
 *  - **It is what a human reads.** The counts are the Scan-now result and the
 *    honest answer to "is this pipeline doing anything?".
 *
 * `skipped_duplicates` is its own column rather than folded into
 * `signals_detected` because the two say opposite things about health: a scan that
 * detected nine signals and filed none because all nine were already open is
 * working perfectly, and must not read as a scan that found nothing.
 *
 * CHECK constraints and indexes live here only — TypeORM cannot express them and
 * `migration:generate` would propose dropping them. Never generate migrations
 * against this table.
 *
 * No tenant column: PostHog is not tenant-partitioned, so a scan is inherently
 * platform-wide. No soft delete: the log is append-only history, and a scan that
 * did not happen is represented by the absence of a row.
 */
export class CreateUxSignalScans1940200000000 implements MigrationInterface {
  name = 'CreateUxSignalScans1940200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ux_signal_scans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trigger" character varying(10) NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'running',
        "window_from" date NOT NULL,
        "window_to" date NOT NULL,
        "signals_detected" integer NOT NULL DEFAULT 0,
        "findings_created" integer NOT NULL DEFAULT 0,
        "suggestions_created" integer NOT NULL DEFAULT 0,
        "skipped_duplicates" integer NOT NULL DEFAULT 0,
        "error" text,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "started_by" integer,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ux_signal_scans_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_ux_signal_scans_trigger" CHECK ("trigger" IN ('scheduled', 'manual')),
        CONSTRAINT "CHK_ux_signal_scans_status" CHECK ("status" IN ('running', 'completed', 'failed'))
      )`,
    );

    // Serves the cadence gate and the log listing, which both read newest-first.
    await queryRunner.query(
      `CREATE INDEX "idx_ux_signal_scans_started_at" ON "ux_signal_scans" ("started_at" DESC)`,
    );
    // Partial: the in-flight check only ever asks about RUNNING rows, of which
    // there should be at most one.
    await queryRunner.query(
      `CREATE INDEX "idx_ux_signal_scans_running" ON "ux_signal_scans" ("started_at")
       WHERE "status" = 'running'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ux_signal_scans"`);
  }
}
