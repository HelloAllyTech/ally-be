import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder's learning loop: each admin message in an interview, classified as a correction or
 * not, and where a correction was routed.
 *
 * ## builder_corrections
 *
 * One row per classified admin message — corrections and non-corrections alike, so the daily
 * scan is idempotent (`messageId` UNIQUE) and the classifier's precision can be measured. A
 * correction carries its category (missing_capability / stale_doc / platform_scope / over_asking
 * / other) and `routes`: the lesson candidate recorded, and drafts for a person — a capability
 * line, a doc fix, a checklist line for the session's eval fixture. Nothing is published from
 * here automatically: the text is production admin text and the repos and wiki are public.
 *
 * No FK to builder_sessions, like builder_lessons: what a correction taught outlives the session.
 */
export class CreateBuilderCorrections1979400000000 implements MigrationInterface {
  name = 'CreateBuilderCorrections1979400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_corrections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "messageId" uuid NOT NULL,
        "sessionTitle" character varying(200),
        "messageAt" TIMESTAMP NOT NULL,
        "adminText" text NOT NULL,
        "builderText" text,
        "isCorrection" boolean NOT NULL,
        "category" character varying(30),
        "subject" character varying(200),
        "detail" text,
        "routes" jsonb,
        "status" character varying(20) NOT NULL DEFAULT 'new',
        "reviewNote" text,
        "reviewedBy" integer,
        "reviewedAt" TIMESTAMP,
        "model" character varying(80),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_corrections_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_corrections_category" CHECK ("category" IS NULL OR "category" IN ('missing_capability', 'stale_doc', 'platform_scope', 'over_asking', 'other')),
        CONSTRAINT "CHK_builder_corrections_status" CHECK ("status" IN ('new', 'reviewed', 'dismissed')),
        CONSTRAINT "CHK_builder_corrections_routes_object" CHECK ("routes" IS NULL OR jsonb_typeof("routes") = 'object')
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_corrections_message" ON "builder_corrections" ("messageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_corrections_session" ON "builder_corrections" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_corrections_message_at" ON "builder_corrections" ("messageAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_corrections"`);
  }
}
