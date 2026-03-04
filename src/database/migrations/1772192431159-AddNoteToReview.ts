import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNoteToReview1772192431159 implements MigrationInterface {
  name = 'AddNoteToReview1772192431159';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD "note" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD "noteEditedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "noteEditedAt"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "note"`);
  }
}
