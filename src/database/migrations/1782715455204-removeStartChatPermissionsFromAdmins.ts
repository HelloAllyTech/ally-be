import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Revoke the ability to *initiate* a recording session from the ADMIN and
 * SUPER_ADMIN roles. Starting a scribe/dictation chat (start:microphone-chat)
 * or a cloud-telephony call (start:cloud-telephony-chat) is a counsellor
 * capability — the COUNSELOR group keeps both permissions (granted in
 * 1760606439959), so a user who is *both* admin and counsellor still gets them
 * via the permission union. An admin-only user no longer sees the "Start
 * Session" button (gated on start:microphone-chat) but retains audio upload
 * (view:audio-upload-url stays on the ADMIN group).
 *
 * This is the inverse of 1779720000000-addTelephonyPermissionsToAdmins.
 */
export class RemoveStartChatPermissionsFromAdmins1782715455204 implements MigrationInterface {
  private readonly permissions = [
    'start:microphone-chat',
    'start:cloud-telephony-chat',
  ];
  private readonly roles = ['ADMIN', 'SUPER_ADMIN'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const roleName of this.roles) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1`,
        [roleName],
      );
      if (group.length === 0) continue;
      const groupId = group[0].id;

      for (const permissionName of this.permissions) {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const roleName of this.roles) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1`,
        [roleName],
      );
      if (group.length === 0) continue;
      const groupId = group[0].id;

      for (const permissionName of this.permissions) {
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
}
