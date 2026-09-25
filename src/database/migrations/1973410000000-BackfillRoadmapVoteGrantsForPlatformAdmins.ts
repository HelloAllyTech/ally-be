import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Issues the roadmap vote grants that PLATFORM_ADMIN-only accounts never received.
 *
 * RoadmapVoteGrantSchedulerRegistrationService (and the day-one grant in
 * CreateRoadmapVoteGrants1962000000000) picked recipients by group name — SUPER_ADMIN and
 * SUPER_DUPER_ADMIN only. Anyone added through the Ally admins screen since the role collapse
 * holds PLATFORM_ADMIN alone: they carry `vote:admin:product-roadmap` (copied from
 * SUPER_DUPER_ADMIN by CreatePlatformAdminRole1895000000001) but were issued nothing, so their
 * balance sat at 0. The scheduler now keys on the permission; this repairs the history.
 *
 * PARITY, not a lump sum: for every daily/monthly grantKey that was actually issued and is
 * still live, each eligible user missing that key gets the same grant the others got — same
 * amount, same grantedAt, same expiresAt (the earliest issued for that key). So a missed
 * admin ends up holding exactly what they would have held had the scheduler seen them, with
 * each backfilled grant lapsing on the same day as everyone else's. Keys that have already
 * expired are skipped — an expired grant is inert, so inserting one would only add noise to
 * the ledger. Days the scheduler never ran for anyone stay un-granted for everyone. And only
 * from the day the user could first vote — their earliest membership of a group holding the
 * permission — so someone added last week isn't paid for the weeks before they joined.
 *
 * Idempotent through the same (userId, source, grantKey) ON CONFLICT DO NOTHING the scheduler
 * uses, so a re-run, or a scheduler tick racing this migration, can't double-grant. Eligibility
 * is inlined, not imported, so this migration keeps meaning what it meant when it ran.
 *
 * `down` is a no-op on purpose: backfilled rows are indistinguishable from scheduler-issued
 * ones, and deleting a grant someone has already drawn from would erase the ledger record that
 * paid for votes still standing on the board.
 */
export class BackfillRoadmapVoteGrantsForPlatformAdmins1973410000000 implements MigrationInterface {
  name = 'BackfillRoadmapVoteGrantsForPlatformAdmins1973410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH eligible AS (
        SELECT ug."userId",
               MIN(GREATEST(ug."createdAt", gp."createdAt")) AS "eligibleSince"
        FROM "user_groups" ug
        INNER JOIN "group_permissions" gp ON gp."groupId" = ug."groupId"
        INNER JOIN "permissions" p ON p."id" = gp."permissionId"
        WHERE p."name" = 'vote:admin:product-roadmap'
        GROUP BY ug."userId"
      ),
      issued AS (
        SELECT "source", "grantKey", MIN("amount") AS "amount",
               MIN("grantedAt") AS "grantedAt", MIN("expiresAt") AS "expiresAt"
        FROM "roadmap_vote_grants"
        WHERE "source" IN ('daily', 'monthly') AND "grantKey" IS NOT NULL
        GROUP BY "source", "grantKey"
        HAVING MIN("expiresAt") > now()
      )
      INSERT INTO "roadmap_vote_grants" ("userId", "source", "amount", "grantedAt", "expiresAt", "grantKey")
      SELECT e."userId", i."source", i."amount", i."grantedAt", i."expiresAt", i."grantKey"
      FROM eligible e
      INNER JOIN issued i
        -- grantKeys are ISO 'YYYY-MM-DD' / 'YYYY-MM', so they compare correctly as text.
        ON i."grantKey" >= to_char(
             e."eligibleSince",
             CASE i."source" WHEN 'daily' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END
           )
      ON CONFLICT ("userId", "source", "grantKey") WHERE "grantKey" IS NOT NULL DO NOTHING
    `);
  }

  public async down(): Promise<void> {
    // Intentionally irreversible — see class docblock.
  }
}
