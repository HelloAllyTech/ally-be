import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Back-tags rows that predate scenario versioning. The AddScenarioVersions
 * migration created a v1 per scenario and set `scenarios.publishedVersionId`,
 * but it never stamped that version onto the EXISTING scenario_sessions /
 * scenario_reports — so their `scenarioVersionId` stayed NULL. As a result,
 * filtering analytics by the default v1 returned nothing (the version filter
 * is an equality on the id), while "all versions" showed the data.
 *
 * These rows ran before any version existed, so the correct attribution is the
 * scenario's published baseline (v1). New sessions/reports are already tagged at
 * creation (publishedVersionId ?? explicit), so this only fills historical NULLs.
 * Idempotent (NULL-guarded); down() is a no-op because a backfill can't be
 * distinguished from a value that was set legitimately.
 */
export class BackfillScenarioVersionOnHistoricalRows1790000000000 implements MigrationInterface {
  name = 'BackfillScenarioVersionOnHistoricalRows1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Sessions → the scenario's published baseline version.
    await queryRunner.query(
      `UPDATE "scenario_sessions" s
          SET "scenarioVersionId" = sc."publishedVersionId"
         FROM "scenarios" sc
        WHERE sc.id = s."scenarioId"
          AND s."scenarioVersionId" IS NULL
          AND sc."publishedVersionId" IS NOT NULL`,
    );

    // 2. Reports → same baseline (keeps per-version report comparison complete).
    await queryRunner.query(
      `UPDATE "scenario_reports" r
          SET "scenarioVersionId" = sc."publishedVersionId"
         FROM "scenarios" sc
        WHERE sc.id = r."scenarioId"
          AND r."scenarioVersionId" IS NULL
          AND sc."publishedVersionId" IS NOT NULL`,
    );

    // 3. Drift judgments → re-propagate from the now-tagged sessions.
    await queryRunner.query(
      `UPDATE "turn_drift_judgment" j
          SET "scenarioVersionId" = s."scenarioVersionId"
         FROM "scenario_sessions" s
        WHERE s.id = j."scenarioSessionId"
          AND j."scenarioVersionId" IS NULL
          AND s."scenarioVersionId" IS NOT NULL`,
    );
  }

  public async down(): Promise<void> {
    // Intentional no-op: a NULL-fill backfill can't be safely reversed without
    // also clearing rows that were tagged legitimately at write time.
  }
}
