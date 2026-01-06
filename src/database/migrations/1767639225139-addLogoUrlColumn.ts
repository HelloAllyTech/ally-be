import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLogoUrlColumn1767639225139 implements MigrationInterface {
  name = 'AddLogoUrlColumn1767639225139';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD "logoUrl" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "logoUrl"`);
  }
}
