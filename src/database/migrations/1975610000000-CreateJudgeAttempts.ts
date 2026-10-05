import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `judge_attempts` — the attempt ledger for the scheduled quality judges
 * (drift, language, feedback groundedness, recall quality).
 *
 * A judge failure, a 600s timeout (after which ally-ai still finishes and
 * bills) or an empty answer writes no judgment row, and "no judgment row" is
 * exactly what every scheduled selector looks for. So a failing subject was
 * re-selected — and re-paid for — every thirty minutes, for as long as it sat
 * inside a window: a day for the catch-ups, 150 days for the drainer. This
 * remembers the failures: three attempts at most, at least an hour apart,
 * cleared by a success. Same rule as foundational skills' FAILED rows.
 *
 * One row per (family, subject), upserted, so the table holds only subjects
 * that are currently failing. Hand-written SQL, never `migration:generate`.
 */
export class CreateJudgeAttempts1975610000000 implements MigrationInterface {
  name = 'CreateJudgeAttempts1975610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "judge_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "family" character varying(32) NOT NULL,
        "subjectId" uuid NOT NULL,
        "attempts" smallint NOT NULL DEFAULT 1,
        "lastOutcome" character varying(16) NOT NULL,
        "lastError" character varying(120),
        "lastAttemptAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_judge_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_judge_attempts_family" CHECK ("family" IN ('drift','language','groundedness','recall-quality')),
        CONSTRAINT "CHK_judge_attempts_last_outcome" CHECK ("lastOutcome" IN ('failed','empty')),
        CONSTRAINT "CHK_judge_attempts_attempts" CHECK ("attempts" >= 1)
      )
    `);
    // The upsert's conflict target, and the index every scheduled selector's
    // NOT EXISTS probe is served by.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_judge_attempts_family_subject" ON "judge_attempts" ("family", "subjectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "judge_attempts"`);
  }
}
