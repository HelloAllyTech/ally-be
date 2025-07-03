import { MigrationInterface, QueryRunner } from 'typeorm';

export class EditSummaryPermission1746613191757 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO permissions (name) VALUES ('edit:summary')`,
    );

    await queryRunner.query(
      `with groupDetails as (select id from groups where name IN ('COUNSELOR','SUPER_ADMIN'))
      insert into group_permissions ("groupId", "permissionId")
      select groupDetails.id, permissions.id from groupDetails, permissions where permissions.name='edit:summary'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `with groupDetails as (select id from groups where name IN ('COUNSELOR','SUPER_ADMIN'))
      delete from group_permissions where "groupId" in (select id from groupDetails) and "permissionId" in (select id from permissions where name='edit:summary')`,
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE name = 'edit:summary'`,
    );
  }
}
