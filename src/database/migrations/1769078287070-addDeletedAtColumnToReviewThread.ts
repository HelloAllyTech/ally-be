import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedAtColumnToReviewThread1769078287070 implements MigrationInterface {
  name = 'AddDeletedAtColumnToReviewThread1769078287070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_threads" ADD "deletedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_threads" DROP COLUMN "deletedAt"`,
    );
  }
}
