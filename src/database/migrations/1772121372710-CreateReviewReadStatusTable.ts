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

    // seed review status
    await queryRunner.query(
      `INSERT INTO review_read_status ("userId", "reviewId", "readAt") SELECT DISTINCT u.id, r.id, NOW() FROM reviews r JOIN users u ON r.tenant_id = u.tenant_id JOIN user_groups ug ON ug."userId" = u.id JOIN groups g ON g.id = ug."groupId" AND g.name = 'REVIEWER' WHERE r.status = 'IN_REVIEW' ON CONFLICT ("userId","reviewId") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_review_read_status_user_id_review_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "review_read_status"`);
  }
}
