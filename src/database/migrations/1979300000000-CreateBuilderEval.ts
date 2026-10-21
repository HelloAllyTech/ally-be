import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder's replay eval: recorded interviews played again through the real interview loop in a
 * sandbox, scored, and used to gate changes to Builder's prompts.
 *
 * ## builder_eval_fixtures
 *
 * One recorded interview (or one PRD, for the critic) with a checklist a person wrote saying what
 * a correct PRD contains. In the database rather than the repo because it carries what a
 * production admin typed and ally-be is public. `sourceSessionId` has no FK: a fixture outlives
 * the session it was cut from.
 *
 * ## builder_eval_suites
 *
 * A set of fixtures, each run `repetitions` times, with any candidate prompt or model settings
 * it was asked to try. A `prompt_gate` suite is also the record of a proposed Builder prompt
 * change: `candidate` goes live only when `verdict` passes, and `publishedAt` says it did.
 *
 * ## builder_eval_runs
 *
 * One fixture played once: the deterministic gates, the metrics, the judge's checklist score, and
 * the replay transcript to read when it fails. Deleted with its suite. A fixture's runs are
 * deleted with the fixture — a run of a fixture that no longer exists cannot be compared to
 * anything.
 *
 * The CHECKs pin the enum-like columns and the JSON shapes the service reads, so a malformed
 * write fails at the database instead of crashing the results page later.
 */
export class CreateBuilderEval1979300000000 implements MigrationInterface {
  name = 'CreateBuilderEval1979300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_eval_fixtures" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(120) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "sourceSessionId" uuid,
        "payload" jsonb NOT NULL,
        "notes" text,
        "active" boolean NOT NULL DEFAULT true,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_eval_fixtures_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_eval_fixtures_kind" CHECK ("kind" IN ('interview', 'prd_review')),
        CONSTRAINT "CHK_builder_eval_fixtures_payload_object" CHECK (jsonb_typeof("payload") = 'object')
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_eval_fixtures_name" ON "builder_eval_fixtures" ("name")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_eval_suites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trigger" character varying(20) NOT NULL,
        "status" character varying(20) NOT NULL,
        "fixtureIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "repetitions" integer NOT NULL,
        "overrides" jsonb,
        "candidate" jsonb,
        "summary" jsonb,
        "verdict" jsonb,
        "publishedAt" TIMESTAMP,
        "error" text,
        "completedAt" TIMESTAMP,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_eval_suites_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_eval_suites_trigger" CHECK ("trigger" IN ('manual', 'baseline', 'prompt_gate')),
        CONSTRAINT "CHK_builder_eval_suites_status" CHECK ("status" IN ('running', 'completed', 'errored')),
        CONSTRAINT "CHK_builder_eval_suites_fixture_ids_array" CHECK (jsonb_typeof("fixtureIds") = 'array'),
        CONSTRAINT "CHK_builder_eval_suites_repetitions" CHECK ("repetitions" BETWEEN 1 AND 10)
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_eval_suites_created" ON "builder_eval_suites" ("createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_eval_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "suiteId" uuid NOT NULL,
        "fixtureId" uuid NOT NULL,
        "repetition" integer NOT NULL,
        "status" character varying(20) NOT NULL,
        "gates" jsonb,
        "metrics" jsonb,
        "judge" jsonb,
        "critic" jsonb,
        "transcript" jsonb,
        "finalPrd" jsonb,
        "error" text,
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_eval_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_eval_runs_suite" FOREIGN KEY ("suiteId")
          REFERENCES "builder_eval_suites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_builder_eval_runs_fixture" FOREIGN KEY ("fixtureId")
          REFERENCES "builder_eval_fixtures"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_eval_runs_status" CHECK ("status" IN ('queued', 'running', 'passed', 'failed', 'errored')),
        CONSTRAINT "CHK_builder_eval_runs_transcript_array" CHECK ("transcript" IS NULL OR jsonb_typeof("transcript") = 'array')
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_eval_runs_suite" ON "builder_eval_runs" ("suiteId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_eval_runs_fixture" ON "builder_eval_runs" ("fixtureId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_eval_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_eval_suites"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_eval_fixtures"`);
  }
}
