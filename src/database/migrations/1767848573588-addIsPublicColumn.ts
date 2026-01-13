import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsPublicColumn1767848573588 implements MigrationInterface {
  name = 'AddIsPublicColumn1767848573588';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "isPublic" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scenarios" DROP COLUMN "isPublic"`);
  }
}
