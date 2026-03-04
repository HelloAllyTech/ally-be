import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewReadStatusTable1772121372710 implements MigrationInterface {
  name = 'CreateReviewReadStatusTable1772121372710';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "review_read_status" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "reviewId" uuid NOT NULL, "readAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_19d0493f3fc6898f810fc162b87" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_review_read_status_user_id_review_id_idx" ON "review_read_status" ("userId", "reviewId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_review_read_status_user_id_review_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "review_read_status"`);
  }
}
