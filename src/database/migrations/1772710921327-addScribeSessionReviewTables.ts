import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScribeSessionReviewTables1772710921327 implements MigrationInterface {
  name = 'AddScribeSessionReviewTables1772710921327';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scribe_session_review_threads" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewId" uuid NOT NULL, "messageId" integer, "createdBy" integer NOT NULL, "selection" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "PK_9af588f578a7c4eb4f79426efc2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scribe_session_reviews" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdBy" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'IN_REVIEW', "note" character varying, "noteEditedAt" TIMESTAMP, "scribeSessionId" uuid NOT NULL, CONSTRAINT "PK_e2884b50fe4169f4775e2b6ab89" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scribe_session_review_read_status" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "reviewId" uuid NOT NULL, "readAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_df80abb8263ed4d958d54e58319" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scribe_session_review_read_status_user_review_idx" ON "scribe_session_review_read_status" ("userId", "reviewId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scribe_session_review_reactions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewId" uuid NOT NULL, "reaction" character varying NOT NULL, "createdBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_5daebeb2294cf71c36e6dcccc61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scribe_session_review_comments" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewThreadId" uuid NOT NULL, "content" character varying NOT NULL, "createdBy" integer NOT NULL, "parentCommentId" uuid, "hidden" boolean DEFAULT false, "deletedAt" TIMESTAMP, CONSTRAINT "PK_6649c975c464a392f8c6719d00a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scribe_session_review_comment_reactions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewCommentId" uuid NOT NULL, "reaction" character varying NOT NULL, "createdBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_6296a98b28fb075506d691d1db5" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "scribe_session_review_comment_reactions"`,
    );
    await queryRunner.query(`DROP TABLE "scribe_session_review_comments"`);
    await queryRunner.query(`DROP TABLE "scribe_session_review_reactions"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_scribe_session_review_read_status_user_review_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scribe_session_review_read_status"`);
    await queryRunner.query(`DROP TABLE "scribe_session_reviews"`);
    await queryRunner.query(`DROP TABLE "scribe_session_review_threads"`);
  }
}
