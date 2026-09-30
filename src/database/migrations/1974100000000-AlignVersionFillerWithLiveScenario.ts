import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns scenario versions' `fillerEnabled` with the live scenario it was
 * forced to by EnableThinkingFillerByDefault1931000000000.
 *
 * That migration set `fillerEnabled=true` on every LIVE `scenarios.metadata`
 * row, including ones whose authors had explicitly turned fillers off, and
 * never touched `scenario_versions`. A learner session runs the live row, so
 * those scenarios play fillers, while their versions still say `false`. In prod
 * (2026-09-30) 27 of 80 scenarios with a published version were in that state.
 * The two copies disagreeing has two effects: Studio's version editor shows
 * fillers off while learners hear them, and re-publishing a version would
 * silently switch them off again (publishVersion replays the version config
 * onto the live row).
 *
 * Product decision (2026-09-30): fillers stay on. So the VERSIONS are brought
 * into line with the live row, not the other way round. Only PUBLISHED and
 * DRAFT versions are changed: those are the ones Studio shows and publish can
 * replay. ARCHIVED versions are history and are left as they were written.
 *
 * `updatedAt` is deliberately NOT bumped. The daily auto-version job turns any
 * draft modified in the preceding 24 hours into a new AUTOMATIC version, so
 * touching it would mint a spurious version per affected draft.
 *
 * Reversible: the rows changed and their previous value are recorded in
 * `scenario_version_filler_backup`, which down() restores from and drops.
 */
export class AlignVersionFillerWithLiveScenario1974100000000 implements MigrationInterface {
  name = 'AlignVersionFillerWithLiveScenario1974100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "scenario_version_filler_backup" (
         "versionId" uuid PRIMARY KEY,
         "previousFillerEnabled" jsonb,
         "alignedAt" timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await queryRunner.query(
      `INSERT INTO "scenario_version_filler_backup" ("versionId", "previousFillerEnabled")
       SELECT v."id", v."config" -> 'fillerEnabled'
         FROM "scenario_versions" v
         JOIN "scenarios" s ON s."id" = v."scenarioId"
        WHERE v."deletedAt" IS NULL
          AND s."deletedAt" IS NULL
          AND v."status" IN ('PUBLISHED', 'DRAFT')
          AND jsonb_typeof(v."config") = 'object'
          AND jsonb_typeof(s."metadata") = 'object'
          AND s."metadata" ->> 'fillerEnabled' = 'true'
          AND v."config" ->> 'fillerEnabled' = 'false'
       ON CONFLICT ("versionId") DO NOTHING`,
    );
    await queryRunner.query(
      `UPDATE "scenario_versions" v
          SET "config" = jsonb_set(v."config", '{fillerEnabled}', 'true'::jsonb)
         FROM "scenario_version_filler_backup" b
        WHERE b."versionId" = v."id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenario_versions" v
          SET "config" = jsonb_set(v."config", '{fillerEnabled}', b."previousFillerEnabled")
         FROM "scenario_version_filler_backup" b
        WHERE b."versionId" = v."id"
          AND b."previousFillerEnabled" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "scenario_version_filler_backup"`,
    );
  }
}
