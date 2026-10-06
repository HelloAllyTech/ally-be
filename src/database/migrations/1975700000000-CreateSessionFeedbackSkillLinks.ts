import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Feedback → skill links — which foundational helping skill each "area of
 * growth" in a session's debrief asks the learner to work on (see
 * src/foundational-skills/constants/feedback-skill-mapper.constants.ts).
 *
 *  - `session_feedback_skill_links` — one row per (session, mapper version):
 *    the skill key (or null) per improvement, by position. Never the
 *    improvement text, which already lives in
 *    `scenario_session_details.summary`. `(scenarioSessionId, mapperVersion)`
 *    is unique, so a version bump maps every session again without touching
 *    the old rows.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateSessionFeedbackSkillLinks1975700000000 implements MigrationInterface {
  name = 'CreateSessionFeedbackSkillLinks1975700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "session_feedback_skill_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scenarioSessionId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "tenant_id" character varying,
        "sessionEndedAt" TIMESTAMP NOT NULL,
        "mapperVersion" character varying(32) NOT NULL,
        "status" character varying(16) NOT NULL,
        "attempts" smallint NOT NULL DEFAULT 1,
        "itemCount" smallint NOT NULL DEFAULT 0,
        "items" jsonb NOT NULL DEFAULT '[]',
        "model" character varying(128),
        "promptTokens" integer,
        "completionTokens" integer,
        "error" text,
        "mappedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_feedback_skill_links" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_session_feedback_skill_links_status" CHECK ("status" IN ('MAPPED','FAILED','SKIPPED')),
        CONSTRAINT "CHK_session_feedback_skill_links_counts" CHECK ("attempts" >= 1 AND "itemCount" >= 0),
        CONSTRAINT "CHK_session_feedback_skill_links_items" CHECK (jsonb_typeof("items") = 'array')
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_session_feedback_skill_links_session_version" ON "session_feedback_skill_links" ("scenarioSessionId", "mapperVersion")`,
    );
    // The analytics read: one version, grouped by learner.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_session_feedback_skill_links_version_user" ON "session_feedback_skill_links" ("mapperVersion", "userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "session_feedback_skill_links"`,
    );
  }
}
