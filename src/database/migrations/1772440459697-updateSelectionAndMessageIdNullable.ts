import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSelectionAndMessageIdNullable1772440459697 implements MigrationInterface {
  name = 'UpdateSelectionAndMessageIdNullable1772440459697';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_threads" ALTER COLUMN "messageId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_threads" ALTER COLUMN "selection" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_threads" ALTER COLUMN "selection" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_threads" ALTER COLUMN "messageId" SET NOT NULL`,
    );
  }
}
