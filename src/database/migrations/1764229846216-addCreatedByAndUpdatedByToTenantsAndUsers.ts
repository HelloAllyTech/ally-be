import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedByAndUpdatedByToTenantsAndUsers1764229846216 implements MigrationInterface {
  name = 'AddCreatedByAndUpdatedByToTenantsAndUsers1764229846216';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "createdBy" integer`);
    await queryRunner.query(`ALTER TABLE "users" ADD "updatedBy" integer`);
    await queryRunner.query(`ALTER TABLE "users" ADD "suspendedBy" integer`);
    await queryRunner.query(`ALTER TABLE "users" ADD "suspendedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD "createdBy" integer`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD "updatedBy" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "updatedBy"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "createdBy"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "suspendedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "suspendedBy"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updatedBy"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "createdBy"`);
  }
}
