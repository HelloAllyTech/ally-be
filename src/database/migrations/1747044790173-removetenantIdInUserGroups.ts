import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemovetenantIdInUserGroups1747044790173 implements MigrationInterface {
  name = 'RemovetenantIdInUserGroups1747044790173';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_groups" DROP COLUMN "tenant_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_groups" ADD "tenant_id" character varying NOT NULL`,
    );
  }
}
