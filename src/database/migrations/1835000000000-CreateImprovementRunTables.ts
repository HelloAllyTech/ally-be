import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auto-improve loop tables:
 *  - roleplay_improvement_runs   — one autonomous rehearse→critique→apply
 *                                  loop over a spec's scratch version lineage.
 *  - roleplay_improvement_rounds — one rehearsal+critique round of a run.
 *  - rehearsal_runs.improvementRoundId — back-pointer so the rehearsal
 *    webhook can advance the owning loop.
 */
export class CreateImprovementRunTables1835000000000 implements MigrationInterface {
  name = 'CreateImprovementRunTables1835000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roleplay_improvement_runs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "baseVersionId" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'RUNNING', "outcome" character varying, "config" jsonb NOT NULL, "currentRound" integer NOT NULL DEFAULT 0, "bestVersionId" uuid, "bestRehearsalId" uuid, "acceptedVersionId" uuid, "metadata" jsonb, "endedAt" TIMESTAMP, "resolvedBy" integer, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_improvement_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_improvement_runs_spec_id" ON "roleplay_improvement_runs" ("specId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "roleplay_improvement_rounds" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "improvementRunId" uuid NOT NULL, "roundNumber" integer NOT NULL, "kind" character varying NOT NULL, "candidateVersionId" uuid NOT NULL, "rehearsalRunId" uuid, "status" character varying NOT NULL DEFAULT 'REHEARSING', "fullScope" boolean NOT NULL DEFAULT true, "scores" jsonb, "deltas" jsonb, "proposalsAppliedCount" integer NOT NULL DEFAULT 0, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_improvement_rounds_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_improvement_rounds_run_id" ON "roleplay_improvement_rounds" ("improvementRunId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_improvement_rounds_rehearsal_run_id" ON "roleplay_improvement_rounds" ("rehearsalRunId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "rehearsal_runs" ADD "improvementRoundId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_runs_improvement_round_id" ON "rehearsal_runs" ("improvementRoundId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_rehearsal_runs_improvement_round_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rehearsal_runs" DROP COLUMN "improvementRoundId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_improvement_rounds_rehearsal_run_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_improvement_rounds_run_id"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_improvement_rounds"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_improvement_runs_spec_id"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_improvement_runs"`);
  }
}
