import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTenantIdInPermission1746791399204
  implements MigrationInterface
{
  name = 'RemoveTenantIdInPermission1746791399204';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE "group_permissions" DROP COLUMN "tenant_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "group_permissions" ADD "tenant_id" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD "tenant_id" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ADD "tenant_id" character varying NOT NULL`,
    );
  }
}
