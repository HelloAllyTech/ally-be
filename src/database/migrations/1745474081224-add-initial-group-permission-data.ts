import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInitialGroupPermissionData1745474081224
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get the COUNSELOR group ID
    const counselorGroup = await queryRunner.query(
      `SELECT id FROM "groups" WHERE "group" = $1`,
      ['COUNSELOR'],
    );

    if (counselorGroup && counselorGroup.length > 0) {
      const counselorGroupId = counselorGroup[0].id;

      // Get all permission IDs
      const permissions = await queryRunner.query(
        `SELECT id FROM "permissions"`,
      );

      // Insert group permissions for COUNSELOR group
      for (const permission of permissions) {
        await queryRunner.query(
          `INSERT INTO "group_permissions" ("groupId", "permissionId") VALUES ($1, $2)`,
          [counselorGroupId, permission.id],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Get the COUNSELOR group ID
    const counselorGroup = await queryRunner.query(
      `SELECT id FROM "groups" WHERE "group" = $1`,
      ['COUNSELOR'],
    );

    if (counselorGroup && counselorGroup.length > 0) {
      const counselorGroupId = counselorGroup[0].id;

      // Delete all permissions for COUNSELOR group
      await queryRunner.query(
        `DELETE FROM "group_permissions" WHERE "groupId" = $1`,
        [counselorGroupId],
      );
    }
  }
}
