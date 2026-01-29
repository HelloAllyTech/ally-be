import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedByToBadge1769674844547 implements MigrationInterface {
  name = 'AddCreatedByToBadge1769674844547';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "badges" ADD "createdBy" integer NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "badges" ADD "updatedBy" integer NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN "updatedBy"`);
    await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN "createdBy"`);
  }
}
