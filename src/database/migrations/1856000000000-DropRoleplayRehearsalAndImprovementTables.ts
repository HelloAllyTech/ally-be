import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deprecate & remove the Roleplay Studio v2 rehearsal harness and the
 * autonomous auto-improve loop. Drops every table those features owned:
 *  - roleplay_critique_proposals   (created in 1834)
 *  - roleplay_improvement_rounds   (created in 1835)
 *  - roleplay_improvement_runs     (created in 1835)
 *  - rehearsal_transcripts         (created in 1813, extended in 1821)
 *  - rehearsal_runs                (created in 1813, extended in 1835)
 *
 * The spec-authoring copilot and the live ROLEPLAY_V2 session runtime + its
 * director telemetry (roleplay_director_events / roleplay_rubric_scores) are
 * untouched. `down` recreates the tables exactly as their original create
 * migrations did, so the drop is reversible.
 */
export class DropRoleplayRehearsalAndImprovementTables1856000000000 implements MigrationInterface {
  name = 'DropRoleplayRehearsalAndImprovementTables1856000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "roleplay_critique_proposals"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "roleplay_improvement_rounds"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_improvement_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rehearsal_transcripts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rehearsal_runs"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // --- rehearsal_runs (1813 + improvementRoundId from 1835) ---
    await queryRunner.query(
      `CREATE TABLE "rehearsal_runs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "specVersionId" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'STARTED', "config" jsonb NOT NULL, "progress" jsonb, "results" jsonb, "reportMarkdown" text, "metadata" jsonb, "endedAt" TIMESTAMP, "improvementRoundId" uuid, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_rehearsal_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_runs_spec_id" ON "rehearsal_runs" ("specId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_runs_spec_version_id" ON "rehearsal_runs" ("specVersionId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_runs_improvement_round_id" ON "rehearsal_runs" ("improvementRoundId") WHERE "deletedAt" IS NULL`,
    );

    // --- rehearsal_transcripts (1813 + test-case columns from 1821) ---
    await queryRunner.query(
      `CREATE TABLE "rehearsal_transcripts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rehearsalRunId" uuid NOT NULL, "traineeProfile" character varying NOT NULL, "transcript" jsonb NOT NULL DEFAULT '[]'::jsonb, "judgeScores" jsonb, "judgeNotes" text, "directorTrace" jsonb, "agentTestCaseId" uuid, "testCaseResult" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "PK_rehearsal_transcripts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_rehearsal_transcripts_run_id" ON "rehearsal_transcripts" ("rehearsalRunId") WHERE "deletedAt" IS NULL`,
    );

    // --- roleplay_critique_proposals (1834) ---
    await queryRunner.query(
      `CREATE TABLE "roleplay_critique_proposals" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rehearsalRunId" uuid NOT NULL, "specVersionId" uuid NOT NULL, "improvementRunId" uuid, "roundNumber" integer, "ops" jsonb NOT NULL, "summary" character varying NOT NULL, "rationale" text NOT NULL, "targetSection" character varying NOT NULL, "severity" character varying NOT NULL, "expectedEffect" jsonb, "status" character varying NOT NULL DEFAULT 'PROPOSED', "appliedInVersionId" uuid, "verification" jsonb, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_critique_proposals_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_critique_proposals_rehearsal_run_id" ON "roleplay_critique_proposals" ("rehearsalRunId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_critique_proposals_improvement_run_id" ON "roleplay_critique_proposals" ("improvementRunId") WHERE "deletedAt" IS NULL`,
    );

    // --- roleplay_improvement_runs (1835) ---
    await queryRunner.query(
      `CREATE TABLE "roleplay_improvement_runs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "baseVersionId" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'RUNNING', "outcome" character varying, "config" jsonb NOT NULL, "currentRound" integer NOT NULL DEFAULT 0, "bestVersionId" uuid, "bestRehearsalId" uuid, "acceptedVersionId" uuid, "metadata" jsonb, "endedAt" TIMESTAMP, "resolvedBy" integer, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_improvement_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_improvement_runs_spec_id" ON "roleplay_improvement_runs" ("specId") WHERE "deletedAt" IS NULL`,
    );

    // --- roleplay_improvement_rounds (1835) ---
    await queryRunner.query(
      `CREATE TABLE "roleplay_improvement_rounds" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "improvementRunId" uuid NOT NULL, "roundNumber" integer NOT NULL, "kind" character varying NOT NULL, "candidateVersionId" uuid NOT NULL, "rehearsalRunId" uuid, "status" character varying NOT NULL DEFAULT 'REHEARSING', "fullScope" boolean NOT NULL DEFAULT true, "scores" jsonb, "deltas" jsonb, "proposalsAppliedCount" integer NOT NULL DEFAULT 0, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_improvement_rounds_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_improvement_rounds_run_id" ON "roleplay_improvement_rounds" ("improvementRunId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_improvement_rounds_rehearsal_run_id" ON "roleplay_improvement_rounds" ("rehearsalRunId") WHERE "deletedAt" IS NULL`,
    );
  }
}
