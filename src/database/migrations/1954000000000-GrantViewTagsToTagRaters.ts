import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Counsellors could rate a tag but never read the tag list.
 *
 * `GET /api/v1/chats/tags` requires `view:tags`, which lives in
 * ADMIN_PERMISSIONS only — while `edit:tag-positivity-ratings` sits in
 * COUNSELOR_PERMISSIONS. So every counsellor's scribe UI called an endpoint it
 * was forbidden to call, and the call-log page rendered as "call logs not
 * found". In production this was the single loudest error: ~1,878 denials on
 * 2026-09-01, one counsellor alone accounting for 754, because ally-web's
 * autosave retry timer (helpline `59a8733c`) re-issued a permanently-403
 * request with no cap.
 *
 * Granted by CAPABILITY, not by role name: any group already holding
 * `edit:tag-positivity-ratings` gets `view:tags`. Roles are cloned per tenant
 * and a clone may carry any name, so `WHERE g.name = 'COUNSELOR'` — the shape
 * used by AddPermissionArchiveCallLogs1770147528530 — silently misses them.
 * The rule this encodes is the invariant that was violated: a role permitted to
 * rate a tag must be permitted to read the tags.
 *
 * NOTE: group permissions are cached in Redis under `group:permissions:*`
 * (also `user:groups:*`, `user:roles:*`), 30-minute TTL, and a raw SQL
 * migration cannot bust them — see PermissionsService. Counsellors keep getting
 * 403 for up to 30 minutes after this runs unless those keys are flushed.
 */
const VIEW_TAGS = 'view:tags';
const RATE_TAGS = 'edit:tag-positivity-ratings';

export class GrantViewTagsToTagRaters1954000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // `view:tags` is created by updatePermissions1758620201178, but never
    // assume: a fresh database that stops short of that migration would make
    // the INSERT below a silent no-op.
    await queryRunner.query(
      // $1 is cast explicitly: in a bare `SELECT $1` Postgres has no column to
      // infer the parameter type from and rejects it as text vs varchar.
      `INSERT INTO "permissions" ("name")
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
      [VIEW_TAGS],
    );

    await queryRunner.query(
      `INSERT INTO "group_permissions" ("groupId", "permissionId")
       SELECT DISTINCT rater."groupId", viewer.id
       FROM "group_permissions" rater
       JOIN "permissions" rated
         ON rated.id = rater."permissionId" AND rated.name = $1
       JOIN "permissions" viewer
         ON viewer.name = $2
       WHERE NOT EXISTS (
         SELECT 1 FROM "group_permissions" existing
         WHERE existing."groupId" = rater."groupId"
           AND existing."permissionId" = viewer.id
       )`,
      [RATE_TAGS, VIEW_TAGS],
    );
  }

  /**
   * Best-effort inverse. Nothing records which rows the up() added, so this
   * revokes `view:tags` from every tag-rating group except the admin roles that
   * are seeded holding it. Verified against the seed data: reverting leaves
   * exactly ADMIN, PLATFORM_ADMIN, SUPER_ADMIN and SUPER_DUPER_ADMIN. A clone
   * of one of those under a different name would still lose a grant it already
   * had — acceptable only because reverting this at all means deliberately
   * restoring the broken state.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions" gp
       USING "permissions" viewer
       WHERE gp."permissionId" = viewer.id
         AND viewer.name = $1
         AND gp."groupId" IN (
           SELECT rater."groupId"
           FROM "group_permissions" rater
           JOIN "permissions" rated
             ON rated.id = rater."permissionId" AND rated.name = $2
         )
         AND gp."groupId" NOT IN (
           SELECT id FROM "groups"
           WHERE name IN (
             'ADMIN', 'PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'
           )
         )`,
      [VIEW_TAGS, RATE_TAGS],
    );
  }
}
