import { MigrationInterface, QueryRunner } from 'typeorm';

export class StartCallPermission1746790206188 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO permissions (name) VALUES ('view:button:start-call')`,
    );

    await queryRunner.query(
      `with groupDetails as (select id from groups where name IN ('CLIENT'))
          insert into group_permissions ("groupId", "permissionId")
          select groupDetails.id, permissions.id from groupDetails, permissions where permissions.name='view:button:start-call'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `with groupDetails as (select id from groups where name IN ('CLIENT'))
          delete from group_permissions where "groupId" in (select id from groupDetails) and "permissionId" in (select id from permissions where name='view:button:start-call')`,
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE name = 'view:button:start-call'`,
    );
  }
}
