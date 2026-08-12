import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfills the Track 2.0 permission set onto SUPER_DUPER_ADMIN.
 *
 * 1828000000000-AddSuperDuperAdminRole cloned SUPER_DUPER_ADMIN's grants from
 * SUPER_ADMIN's group_permissions rows as they stood at the time it ran in
 * production — a day *before* 1826000000000-TrackPermissions was merged and
 * granted these permissions to SUPER_ADMIN. TypeORM only runs pending
 * migrations in timestamp order among those not yet applied; it does not
 * re-run or backfill an already-applied migration, so the clone permanently
 * missed the Track 2.0 permissions. This causes "Forbidden resource" on
 * admin Track (Course) endpoints — e.g. duplicate — for SUPER_DUPER_ADMIN.
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL (src/authorization/service/permissions.service.ts) —
 * flush those keys after deploying this migration or the endpoints will
 * keep 403ing until the cache expires.
 */
const NEW_PERMISSIONS = [
  'view:admin:tracks',
  'view:admin:track',
  'edit:admin:track',
  'delete:admin:track',
  'edit:tenant:track',
  'edit:track-tenant',
  'delete:track-tenant',
  'view:tracks',
  'view:track',
  'edit:track',
];

const GROUP_GRANTS: Record<string, string[]> = {
  SUPER_DUPER_ADMIN: NEW_PERMISSIONS,
};

export class BackfillTrackPermissionsSuperDuperAdmin1893000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [groupName, permissionNames] of Object.entries(GROUP_GRANTS)) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      for (const name of permissionNames) {
        const perm = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
          [name],
        );
        const permId = perm?.[0]?.id;
        if (!permId) continue;

        const existingGrant = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permId],
        );
        if (existingGrant.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [groupName, permissionNames] of Object.entries(GROUP_GRANTS)) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      await queryRunner.query(
        `DELETE FROM "group_permissions" WHERE "groupId" = $1 AND "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($2))`,
        [groupId, permissionNames],
      );
    }
  }
}
