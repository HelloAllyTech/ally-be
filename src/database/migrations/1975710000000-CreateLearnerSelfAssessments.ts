import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Learner self-efficacy instrument — how confident a learner says they are at
 * each foundational helping skill, 0–10, asked at onboarding, every 3 scored
 * cuts and on course completion (src/foundational-skills/constants/
 * self-efficacy-instrument.constants.ts).
 *
 *  - `learner_self_assessments` — one answer. `responses` is
 *    `{ "<rubric skill key>": 0..10 }` with only the answered items (an empty
 *    object is a dismissed prompt). The CHECK makes "integers 0–10, nothing
 *    else" a property of the table rather than of one controller, so no free
 *    text can ever land in it. Which keys are valid depends on the instrument
 *    version, so that stays in code.
 *
 * Append-only; no FK to `users` (like the foundational-skill tables), no soft
 * delete. Hand-written SQL, never `migration:generate`.
 */
export class CreateLearnerSelfAssessments1975710000000 implements MigrationInterface {
  name = 'CreateLearnerSelfAssessments1975710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "learner_self_assessments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying NOT NULL,
        "userId" integer NOT NULL,
        "instrumentVersion" character varying(32) NOT NULL,
        "trigger" character varying(16) NOT NULL,
        "triggerRef" character varying(64),
        "responses" jsonb NOT NULL DEFAULT '{}',
        "answeredAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_learner_self_assessments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_learner_self_assessments_trigger" CHECK ("trigger" IN ('ONBOARDING','CUTS','COURSE')),
        CONSTRAINT "CHK_learner_self_assessments_trigger_ref" CHECK (
          ("trigger" <> 'CUTS' OR "triggerRef" ~ '^[0-9]+$')
          AND ("trigger" <> 'COURSE' OR "triggerRef" IS NOT NULL)
        ),
        CONSTRAINT "CHK_learner_self_assessments_responses" CHECK (
          jsonb_typeof("responses") = 'object'
          AND NOT jsonb_path_exists("responses", '$.* ? (@.type() != "number" || @ < 0 || @ > 10 || @ != @.floor())')
        )
      )
    `);
    // The two reads: a learner's latest answer (is one due?) and every answer
    // in order per learner (first vs latest).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_learner_self_assessments_user_answered" ON "learner_self_assessments" ("userId", "answeredAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "learner_self_assessments"`);
  }
}
