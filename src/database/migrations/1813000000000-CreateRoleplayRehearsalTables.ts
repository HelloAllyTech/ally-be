import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roleplay Studio v2 rehearsal tables (scenario_reports lifecycle clone):
 *  - rehearsal_runs        — one automated rehearsal of a spec version
 *                            (SKILLED / POOR / ADVERSARIAL simulated trainees
 *                            + LLM judge in ally-ai-learn); status/progress/
 *                            results updated by the rehearsal webhook.
 *  - rehearsal_transcripts — one simulated conversation per trainee profile.
 */
export class CreateRoleplayRehearsalTables1813000000000 implements MigrationInterface {
  name = 'CreateRoleplayRehearsalTables1813000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "rehearsal_runs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "specVersionId" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'STARTED', "config" jsonb NOT NULL, "progress" jsonb, "results" jsonb, "reportMarkdown" text, "metadata" jsonb, "endedAt" TIMESTAMP, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_rehearsal_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_runs_spec_id" ON "rehearsal_runs" ("specId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_runs_spec_version_id" ON "rehearsal_runs" ("specVersionId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "rehearsal_transcripts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rehearsalRunId" uuid NOT NULL, "traineeProfile" character varying NOT NULL, "transcript" jsonb NOT NULL DEFAULT '[]'::jsonb, "judgeScores" jsonb, "judgeNotes" text, "directorTrace" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "PK_rehearsal_transcripts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_transcripts_run_id" ON "rehearsal_transcripts" ("rehearsalRunId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_rehearsal_transcripts_run_id"`,
    );
    await queryRunner.query(`DROP TABLE "rehearsal_transcripts"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_rehearsal_runs_spec_version_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_rehearsal_runs_spec_id"`);
    await queryRunner.query(`DROP TABLE "rehearsal_runs"`);
  }
}
