import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveOrgIdInDashboard1746770442124 implements MigrationInterface {
  name = 'RemoveOrgIdInDashboard1746770442124';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dashboard" DROP COLUMN "organizationId"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dashboard" ADD "organizationId" character varying`,
    );
  }
}
