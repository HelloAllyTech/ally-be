import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * roleplay_critique_proposals — persisted rehearsal-critique proposals
 * (normalized RFC-6902 ops + rationale + predicted effect + lifecycle
 * status). The audit trail behind both the interactive accept/reject flow
 * and the auto-improve loop's verification + oscillation guard.
 */
export class CreateCritiqueProposals1834000000000 implements MigrationInterface {
  name = 'CreateCritiqueProposals1834000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roleplay_critique_proposals" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rehearsalRunId" uuid NOT NULL, "specVersionId" uuid NOT NULL, "improvementRunId" uuid, "roundNumber" integer, "ops" jsonb NOT NULL, "summary" character varying NOT NULL, "rationale" text NOT NULL, "targetSection" character varying NOT NULL, "severity" character varying NOT NULL, "expectedEffect" jsonb, "status" character varying NOT NULL DEFAULT 'PROPOSED', "appliedInVersionId" uuid, "verification" jsonb, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_critique_proposals_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_critique_proposals_rehearsal_run_id" ON "roleplay_critique_proposals" ("rehearsalRunId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_critique_proposals_improvement_run_id" ON "roleplay_critique_proposals" ("improvementRunId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_critique_proposals_improvement_run_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_critique_proposals_rehearsal_run_id"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_critique_proposals"`);
  }
}
