import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1941000000000-DropRoleplayStudioV2 removed Roleplay Studio v2's tables and
 * permissions, but its `names` array only listed five of the seven
 * permissions seeded by 1817000000000-RoleplayStudioPermissions — it missed
 * view:roleplay-rehearsals and edit:roleplay-rehearsals. Those two rows, and
 * their SUPER_ADMIN group_permissions grants, were left behind for a feature
 * that no longer exists. Cleaning them up here so the names are free to be
 * reused without inheriting stale grants.
 */
const names = ['view:roleplay-rehearsals', 'edit:roleplay-rehearsals'];

export class DropRemainingRoleplayStudioV2Permissions1944500000000 implements MigrationInterface {
  name = 'DropRemainingRoleplayStudioV2Permissions1944500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permissionName of names) {
      await queryRunner.query(
        `DELETE FROM group_permissions
           WHERE "permissionId" = (SELECT id FROM "permissions" WHERE name = $1)`,
        [permissionName],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
        permissionName,
      ]);
    }
  }

  public async down(): Promise<void> {
    throw new Error(
      'DropRemainingRoleplayStudioV2Permissions is not reversible. The ' +
        'permissions and their grants are gone; restore from a snapshot to ' +
        'go back.',
    );
  }
}
