import { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_GROUP = 'PLATFORM_ADMIN';
const OLD_GROUPS = ['SUPER_ADMIN', 'SUPER_DUPER_ADMIN', 'MULTI_TENANT_ADMIN'];

/**
 * Data-only correction — no DDL. `user_groups` has carried
 * `"createdAt" TIMESTAMP NOT NULL DEFAULT now()` since it was created
 * (AddUserPermissions1745471638067), so the date a role was granted has always
 * been stored; the Ally admins screen just never read it, showing
 * `users."createdAt"` (the account's birthday) under an "Added on" heading
 * instead. Reading the right column is the fix, but it needs this backfill
 * first, because of how the role collapse wrote its rows.
 *
 * CreatePlatformAdminRole1895000000001 granted PLATFORM_ADMIN with a plain
 * `INSERT INTO "user_groups" ("userId", "groupId") SELECT ...`, letting
 * `createdAt` default to `now()`. So every admin who predates the rollout has a
 * PLATFORM_ADMIN row stamped with the *migration's* run time. Read as-is, the
 * column would claim the entire existing admin roster was added on one day —
 * wrong in a new way, and it would have thrown away real history that is still
 * on disk: that same migration deliberately kept the three retired tier groups
 * and their `user_groups` rows for rollback safety, each still carrying the
 * timestamp of the original grant.
 *
 * So: pull each PLATFORM_ADMIN row's `createdAt` back to the earliest timestamp
 * among that user's retired-tier rows, when there is an earlier one. Admins
 * added through the screen after the rollout have no legacy row and are left
 * exactly as they are — their timestamp is already the truth.
 *
 * Accuracy ceiling worth knowing when auditing: a legacy row written by a
 * promote-this-person migration (e.g.
 * PromoteGopikrishnanToSuperDuperAdmin1838000000000) is stamped with that
 * migration's run time, not the day the decision was made. Close, not exact.
 * Everything granted through the UI is exact. Once the planned cleanup
 * migration drops the retired tier groups this source is gone, which is the
 * other reason to do the backfill now rather than resolve it at query time.
 */
export class BackfillPlatformAdminGrantDates1901000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE "user_groups" AS platform_admin_row
      SET "createdAt" = legacy."firstGrantedAt"
      FROM (
        SELECT ug."userId", MIN(ug."createdAt") AS "firstGrantedAt"
        FROM "user_groups" ug
        JOIN "groups" g ON g.id = ug."groupId"
        WHERE g.name = ANY($2::character varying[])
        GROUP BY ug."userId"
      ) AS legacy
      WHERE platform_admin_row."userId" = legacy."userId"
      AND platform_admin_row."groupId" IN (
        SELECT id FROM "groups" WHERE name = $1
      )
      AND legacy."firstGrantedAt" < platform_admin_row."createdAt"
      `,
      [NEW_GROUP, OLD_GROUPS],
    );
  }

  /**
   * Deliberately a no-op. The timestamps this replaced were the rollout
   * migration's own run time, not information about when anyone was granted
   * access — there is nothing worth restoring, and restoring it would put the
   * misleading dates back. Re-running `up` is safe: it only ever moves a
   * timestamp earlier, and only when an earlier one exists.
   */
  public async down(): Promise<void> {
    // no-op — see above
  }
}
