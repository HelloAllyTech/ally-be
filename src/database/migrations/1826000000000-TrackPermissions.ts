import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Track 2.0 permissions (mirrors the scenario-path permission split):
 *  - SUPER_ADMIN → full admin set + tenant assignment
 *  - ADMIN (tenant admin) → view admin tracks + assign/remove own-tenant
 *    visibility (endpoints are additionally pinned by OwnTenantScopeGuard)
 *  - LEARNER → browse/view/consume tracks
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL (src/authorization/service/permissions.service.ts) —
 * flush those keys after deploying this migration or new endpoints will 403
 * until the cache expires.
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
  SUPER_ADMIN: NEW_PERMISSIONS,
  ADMIN: [
    'view:admin:tracks',
    'view:admin:track',
    'edit:track-tenant',
    'delete:track-tenant',
  ],
  LEARNER: ['view:tracks', 'view:track', 'edit:track'],
};

export class TrackPermissions1826000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of NEW_PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [name],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }

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
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [NEW_PERMISSIONS],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      NEW_PERMISSIONS,
    ]);
  }
}
