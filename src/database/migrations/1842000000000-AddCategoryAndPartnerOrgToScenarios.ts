import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryAndPartnerOrgToScenarios1842000000000 implements MigrationInterface {
  name = 'AddCategoryAndPartnerOrgToScenarios1842000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "category" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "partnerOrgName" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenarios_category" ON "scenarios" ("category") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_scenarios_category"`);
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "partnerOrgName"`,
    );
    await queryRunner.query(`ALTER TABLE "scenarios" DROP COLUMN "category"`);
  }
}
