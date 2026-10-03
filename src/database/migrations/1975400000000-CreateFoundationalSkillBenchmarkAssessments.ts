import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foundational helping skills BENCHMARK — one fixed roleplay taken at
 * onboarding and again later, each completed session scored whole against the
 * same rubric as the cuts (see src/foundational-skills/constants/
 * fhs-benchmark.constants.ts).
 *
 *  - `foundational_skill_benchmark_assessments` — the rubric judgement of one
 *    benchmark session under one rubric version. `(sessionId, rubricVersion)`
 *    is unique, so a version bump re-scores every benchmark session without
 *    touching the old rows. No transcript text is stored.
 *
 * Which scenarios are benchmarks is `scenarios.metadata.fhsBenchmark` (free
 * JSONB, no schema change). Hand-written SQL, never `migration:generate`.
 */
export class CreateFoundationalSkillBenchmarkAssessments1975400000000 implements MigrationInterface {
  name = 'CreateFoundationalSkillBenchmarkAssessments1975400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "foundational_skill_benchmark_assessments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "scenarioId" integer NOT NULL,
        "tenant_id" character varying,
        "sessionEndedAt" TIMESTAMP NOT NULL,
        "rubricVersion" character varying(64) NOT NULL,
        "status" character varying(16) NOT NULL,
        "attempts" smallint NOT NULL DEFAULT 1,
        "model" character varying(128),
        "compositeScore" numeric(4,2),
        "hasUnhelpfulBehaviour" boolean,
        "skillLevels" jsonb NOT NULL DEFAULT '{}',
        "verdicts" jsonb NOT NULL DEFAULT '[]',
        "droppedTicks" integer NOT NULL DEFAULT 0,
        "promptTokens" integer,
        "completionTokens" integer,
        "learnerChars" integer NOT NULL DEFAULT 0,
        "cutsBefore" integer NOT NULL DEFAULT 0,
        "error" text,
        "scoredAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_foundational_skill_benchmark_assessments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_foundational_skill_benchmark_assessments_status" CHECK ("status" IN ('SCORED','FAILED','SKIPPED')),
        CONSTRAINT "CHK_foundational_skill_benchmark_assessments_composite" CHECK ("compositeScore" IS NULL OR "compositeScore" BETWEEN 1 AND 4),
        CONSTRAINT "CHK_foundational_skill_benchmark_assessments_counts" CHECK ("learnerChars" >= 0 AND "cutsBefore" >= 0 AND "attempts" >= 1)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_foundational_skill_benchmark_assessments_session_version" ON "foundational_skill_benchmark_assessments" ("sessionId", "rubricVersion")`,
    );
    // The analytics read: one version, grouped by scenario and learner. Named
    // short of Postgres's 63-character identifier limit, which would otherwise
    // silently truncate it.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_foundational_skill_benchmark_assessments_version" ON "foundational_skill_benchmark_assessments" ("rubricVersion", "scenarioId", "userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "foundational_skill_benchmark_assessments"`,
    );
  }
}
