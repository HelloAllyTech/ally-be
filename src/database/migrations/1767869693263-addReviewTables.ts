import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewTables1767869693263 implements MigrationInterface {
  name = 'AddReviewTables1767869693263';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "review_reactions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewId" character varying NOT NULL, "reaction" character varying NOT NULL, "createdBy" integer NOT NULL, CONSTRAINT "PK_b82cdf2aa25d47c14de0200e86b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "reviews" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid NOT NULL, "createdBy" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'IN_REVIEW', CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "review_threads" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewId" uuid NOT NULL, "messageId" integer NOT NULL, "createdBy" integer NOT NULL, "selection" jsonb NOT NULL, CONSTRAINT "PK_6d08b124f13cf25fa68fc474a94" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "review_comment_reactions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewCommentId" uuid NOT NULL, "reaction" character varying NOT NULL, "createdBy" integer NOT NULL, CONSTRAINT "PK_1057c8f28008e6775af355278aa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "review_comments" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewThreadId" uuid NOT NULL, "content" character varying NOT NULL, "createdBy" integer NOT NULL, "parentCommentId" uuid, "hidden" boolean DEFAULT false, "deletedAt" TIMESTAMP, CONSTRAINT "PK_7a18556c348d381630855d05f0a" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "review_comments"`);
    await queryRunner.query(`DROP TABLE "review_comment_reactions"`);
    await queryRunner.query(`DROP TABLE "review_threads"`);
    await queryRunner.query(`DROP TABLE "reviews"`);
    await queryRunner.query(`DROP TABLE "review_reactions"`);
  }
}
