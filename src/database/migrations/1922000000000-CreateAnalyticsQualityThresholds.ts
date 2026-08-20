import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalisation anchors for the Roleplay Quality Index (Highlights → Quality &
 * sentiment). One row per dimension.
 *
 * Seeded with PLACEHOLDER values so the card renders immediately on release.
 * The real anchors are measured from production traffic by
 * `QualityThresholdCalibrationService` on its first scheduler tick in an
 * environment that has enough data, which then flips the row to
 * `source = 'measured'` and freezes it.
 *
 * ## Why the measurement is not done here
 *
 * It was the obvious place for it, and it is the wrong place, for two reasons.
 *
 * A migration runs EXACTLY ONCE. If production traffic happens to be thin in
 * the window at deploy time — a quiet week, or a judge backlog mid-drain — the
 * bad anchors freeze permanently and the only remedy is another migration. The
 * task instead retries every tick until each dimension clears its sample floor,
 * so calibration waits for the data rather than racing the deploy.
 *
 * And the measurement has to honour pinned judge versions,
 * `excludeTestTenants()` and `countableSessionPredicate()` — TypeScript helpers
 * that exist precisely because three code paths once answered "which sessions
 * count?" three different ways. Inlining their SQL here would fork them
 * permanently, in a file that by convention is never edited again.
 *
 * So this migration owns the schema and the placeholders; the task owns the
 * measurement. The placeholder values live in
 * `analytics/constants/quality-index.constants.ts` and are duplicated here as
 * literals on purpose: a migration must not import application constants that
 * may be refactored or deleted later, or it stops being replayable.
 */
export class CreateAnalyticsQualityThresholds1922000000000
  implements MigrationInterface
{
  name = 'CreateAnalyticsQualityThresholds1922000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "analytics_quality_thresholds" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "dimension" character varying(64) NOT NULL,
        "target" double precision NOT NULL,
        "ceiling" double precision NOT NULL,
        "source" character varying(16) NOT NULL DEFAULT 'placeholder',
        "sampleSize" integer,
        "measuredAt" TIMESTAMP,
        CONSTRAINT "PK_analytics_quality_thresholds" PRIMARY KEY ("id")
      )
    `);

    // The calibration task's upsert target, and what makes re-running this
    // migration on a partially-migrated database a no-op rather than a second
    // set of anchors for the same dimension.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics_quality_thresholds_dimension_uq"
        ON "analytics_quality_thresholds" ("dimension")
    `);

    // Placeholders. ON CONFLICT DO NOTHING so a re-run cannot overwrite anchors
    // that calibration has since measured — the one way this migration could
    // otherwise destroy real data.
    await queryRunner.query(`
      INSERT INTO "analytics_quality_thresholds"
        ("dimension", "target", "ceiling", "source")
      VALUES
        ('actorComposite',  90,   40,   'placeholder'),
        ('driftRate',        0,   25,   'placeholder'),
        ('languageErrors',   0,   20,   'placeholder'),
        ('responseLatency', 800, 3000,  'placeholder')
      ON CONFLICT ("dimension") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "analytics_quality_thresholds_dimension_uq"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "analytics_quality_thresholds"
    `);
  }
}
