import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Takes the text helpline workspace back from the tenant ADMIN group.
 *
 * 1975750000000-AddHelplinePermissions gave ADMIN the whole HELPLINE_SUPERVISOR
 * set, so in an org with the helpline switched on every org admin saw the
 * Helpline tab and could open, claim, read and monitor crisis chats without
 * ever being made a Listener or Supervisor. The workspace is now for those two
 * groups only: an org admin who should take or supervise chats is given one of
 * them like anyone else, and the permissions union across their groups.
 *
 * Kept on ADMIN: `edit:helpline:team`. It opens nothing on its own — the Team
 * page lives inside the workspace, which needs a lobby or monitor permission —
 * so it only lets an admin who is also a Listener or Supervisor staff their
 * org's helpline from Helpline → Team. Ally staff assign the two groups from
 * the admin console's Change role picker.
 *
 * No org had the helpline switched on in production when this was written, so
 * no admin loses a chat in progress or a risk alert they were relying on.
 *
 * Group permissions are cached in Redis for 30 minutes
 * (src/authorization/service/permissions.service.ts), so a revoked grant keeps
 * working until the cache expires unless `*group:permissions:*` is flushed.
 */
const REVOKED_FROM_ADMIN = [
  // LISTENER set
  'view:helpline:lobby',
  'edit:helpline:presence',
  'edit:helpline:claim',
  'view:helpline:chat',
  'edit:helpline:message',
  'edit:helpline:end',
  'view:helpline:copilot',
  'edit:helpline:summary',
  // HELPLINE_SUPERVISOR additions
  'view:helpline:monitor',
  'edit:helpline:whisper',
  'edit:helpline:transfer',
  'view:helpline:qa',
];

export class RevokeTenantAdminHelplineWorkspaceGrants1976600000000 implements MigrationInterface {
  name = 'RevokeTenantAdminHelplineWorkspaceGrants1976600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM group_permissions
         WHERE "groupId" IN (SELECT id FROM groups WHERE name = 'ADMIN')
           AND "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [REVOKED_FROM_ADMIN],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO group_permissions ("groupId", "permissionId")
         SELECT g.id, p.id
           FROM groups g
           JOIN "permissions" p ON p.name = ANY($1)
          WHERE g.name = 'ADMIN'
            AND NOT EXISTS (
              SELECT 1 FROM group_permissions gp
               WHERE gp."groupId" = g.id AND gp."permissionId" = p.id
            )`,
      [REVOKED_FROM_ADMIN],
    );
  }
}
