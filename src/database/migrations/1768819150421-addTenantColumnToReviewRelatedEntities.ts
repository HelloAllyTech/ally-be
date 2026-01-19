import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantColumnToReviewRelatedEntities1768819150421 implements MigrationInterface {
  name = 'AddTenantColumnToReviewRelatedEntities1768819150421';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_threads" ADD "tenant_id" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reactions" ADD "tenant_id" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_comments" ADD "tenant_id" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_comment_reactions" ADD "tenant_id" character varying NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_comment_reactions" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_comments" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reactions" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_threads" DROP COLUMN "tenant_id"`,
    );
  }
}
