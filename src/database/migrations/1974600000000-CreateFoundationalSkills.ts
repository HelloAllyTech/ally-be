import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foundational helping skills — a passive, scenario-independent measure of how
 * learners' helping skills change with practice (see
 * docs/foundational-helping-skills.md and src/foundational-skills).
 *
 *  - `foundational_skill_cuts` — fixed 5,000-character slices of each learner's
 *    own roleplay speech, in the order their sessions ended. Append-only and
 *    rubric-independent; no transcript text is copied.
 *  - `foundational_skill_assessments` — the rubric judgement of a cut under one
 *    rubric version. `(cutId, rubricVersion)` is unique, so a version bump
 *    re-scores every cut without touching the old rows.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateFoundationalSkills1974600000000 implements MigrationInterface {
  name = 'CreateFoundationalSkills1974600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "foundational_skill_cuts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL,
        "cutIndex" integer NOT NULL,
        "tenant_id" character varying,
        "sessionIds" uuid[] NOT NULL,
        "startSessionId" uuid NOT NULL,
        "startMessageId" integer NOT NULL,
        "endSessionId" uuid NOT NULL,
        "endMessageId" integer NOT NULL,
        "startsMidSession" boolean NOT NULL,
        "endsMidSession" boolean NOT NULL,
        "learnerChars" integer NOT NULL,
        "totalChars" integer NOT NULL,
        "closedSessionEndedAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_foundational_skill_cuts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_foundational_skill_cuts_index" CHECK ("cutIndex" >= 1)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_foundational_skill_cuts_user_cut" ON "foundational_skill_cuts" ("userId", "cutIndex")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "foundational_skill_assessments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cutId" uuid NOT NULL,
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
        "error" text,
        "scoredAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_foundational_skill_assessments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_foundational_skill_assessments_status" CHECK ("status" IN ('SCORED','FAILED')),
        CONSTRAINT "CHK_foundational_skill_assessments_composite" CHECK ("compositeScore" IS NULL OR "compositeScore" BETWEEN 1 AND 4),
        CONSTRAINT "FK_foundational_skill_assessments_cut" FOREIGN KEY ("cutId")
          REFERENCES "foundational_skill_cuts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_foundational_skill_assessments_cut_version" ON "foundational_skill_assessments" ("cutId", "rubricVersion")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "foundational_skill_assessments"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "foundational_skill_cuts"`);
  }
}
