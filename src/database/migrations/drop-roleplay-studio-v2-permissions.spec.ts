import { QueryRunner } from 'typeorm';
import { DropRoleplayStudioV21941000000000 } from './1941000000000-DropRoleplayStudioV2';
import { DropRemainingRoleplayStudioV2Permissions1944500000000 } from './1944500000000-DropRemainingRoleplayStudioV2Permissions';

describe('DropRoleplayStudioV2 permission cleanup', () => {
  it('deletes all seven Roleplay Studio v2 permissions created by 1817000000000-RoleplayStudioPermissions, not just five', async () => {
    // Mirrors NEW_PERMISSIONS in 1817000000000-RoleplayStudioPermissions.ts.
    const ALL_SEVEN_PERMISSIONS = [
      'view:roleplay-specs',
      'edit:roleplay-spec',
      'delete:roleplay-spec',
      'edit:roleplay-copilot',
      'view:roleplay-rehearsals',
      'edit:roleplay-rehearsals',
      'edit:roleplay-spec-tenant',
    ];

    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const queryRunner = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return [];
      }),
    } as unknown as QueryRunner;

    // 1941000000000-DropRoleplayStudioV2 is the merged migration that removed
    // Roleplay Studio v2; it must not be edited. The two names it missed are
    // cleaned up by the follow-up migration below.
    await new DropRoleplayStudioV21941000000000().up(queryRunner);
    await new DropRemainingRoleplayStudioV2Permissions1944500000000().up(
      queryRunner,
    );

    const deletedPermissionNames = queries
      .filter((q) => q.sql.includes('DELETE FROM "permissions" WHERE name'))
      .map((q) => q.params[0]);

    for (const name of ALL_SEVEN_PERMISSIONS) {
      expect(deletedPermissionNames).toContain(name);
    }
  });
});
