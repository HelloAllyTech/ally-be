import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1745396810439 implements MigrationInterface {
  name = 'Migrations1745396810439';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "phone" text`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_a000cca60bcf04454e727699490"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
  }
}
