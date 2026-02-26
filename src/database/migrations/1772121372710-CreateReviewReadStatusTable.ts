import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewReadStatusTable1772121372710 implements MigrationInterface {
  name = 'CreateReviewReadStatusTable1772121372710';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "review_read_status" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "reviewId" uuid NOT NULL, "readAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_review_read_status_user_review" UNIQUE ("userId", "reviewId"), CONSTRAINT "PK_review_read_status" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "review_read_status"`);
  }
}
