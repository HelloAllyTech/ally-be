import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable home for admin-preview internal monologues.
 *
 * Previews have no scenario_session row and every SQS processor drops
 * `preview-%`, so before this the monologue existed only in the browser of
 * whoever happened to be watching. See PreviewMonologueRun for why the
 * monologue is the one exception to preview ephemerality.
 */
export class CreatePreviewMonologueRuns1943000000000 implements MigrationInterface {
  name = 'CreatePreviewMonologueRuns1943000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "preview_monologue_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "roomName" character varying(255) NOT NULL,
        "scenarioId" integer NOT NULL,
        "scenarioVersionId" uuid,
        "languageId" integer,
        "tenant_id" character varying,
        "startedByUserId" integer,
        "turns" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "turnCount" integer NOT NULL DEFAULT 0,
        "endedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_preview_monologue_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_preview_monologue_runs_room" UNIQUE ("roomName")
      )
    `);

    // The only read path: newest runs for one scenario.
    await queryRunner.query(`
      CREATE INDEX "IDX_preview_monologue_runs_scenario"
        ON "preview_monologue_runs" ("scenarioId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_preview_monologue_runs_scenario"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "preview_monologue_runs"`);
  }
}
