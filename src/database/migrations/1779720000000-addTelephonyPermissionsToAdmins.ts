import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelephonyPermissionsToAdmins1779720000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = ['start:microphone-chat', 'start:cloud-telephony-chat'];
    const roles = ['ADMIN', 'SUPER_ADMIN'];

    for (const roleName of roles) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1`,
        [roleName],
      );
      if (group.length === 0) continue;
      const groupId = group[0].id;

      for (const permissionName of permissions) {
        const permission = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1`,
          [permissionName],
        );
        if (permission.length === 0) continue;
        const permissionId = permission[0].id;

        const existing = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permissionId],
        );

        if (existing.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permissionId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissions = ['start:microphone-chat', 'start:cloud-telephony-chat'];
    const roles = ['ADMIN', 'SUPER_ADMIN'];

    for (const roleName of roles) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1`,
        [roleName],
      );
      if (group.length === 0) continue;
      const groupId = group[0].id;

      for (const permissionName of permissions) {
        const permission = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1`,
          [permissionName],
        );
        if (permission.length === 0) continue;
        const permissionId = permission[0].id;

        await queryRunner.query(
          `DELETE FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permissionId],
        );
      }
    }
  }
}
