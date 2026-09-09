import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The vote-grant ledger, replacing the flat "100 votes per calendar month" cap with three
 * independently-expiring credit streams: 50/month, 5/day, each spendable for 30 days from
 * issuance. See RoadmapVoteGrant's docblock for the full shape and RoadmapAllocationService
 * for how it's spent.
 *
 * This migration also does a ONE-TIME DATA STEP: issuing today's daily grant to every
 * currently-eligible platform admin. Without it, nobody could cast a new vote until the
 * scheduler's first daily tick (`RoadmapVoteGrantSchedulerRegistrationService`, up to ~24h
 * away) — "start assigning 5 more every day" means starting now, not tomorrow. This uses the
 * exact same idempotent ON CONFLICT DO NOTHING the scheduler uses, keyed on
 * (userId, source, grantKey), so if the scheduler's first tick lands the same UTC day as this
 * migration runs, only one grant survives — never two.
 *
 * Deliberately NOT backfilling a 50-vote monthly grant here, and NOT touching
 * roadmap_allocations at all: every vote already cast this month stays exactly as cast, and
 * the first 50-vote grant arrives on the normal 1st-of-month schedule. Both are explicit
 * product decisions for this cutover, not oversights.
 */
export class CreateRoadmapVoteGrants1962050000000 implements MigrationInterface {
  name = 'CreateRoadmapVoteGrants1962050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roadmap_vote_grants" (
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL,
        "source" character varying NOT NULL,
        "amount" integer NOT NULL,
        "consumed" integer NOT NULL DEFAULT 0,
        "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "grantKey" character varying,
        CONSTRAINT "PK_roadmap_vote_grants_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_roadmap_vote_grants_source" CHECK ("source" IN ('monthly', 'daily', 'refund')),
        CONSTRAINT "CHK_roadmap_vote_grants_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_roadmap_vote_grants_consumed" CHECK ("consumed" >= 0 AND "consumed" <= "amount")
      )
    `);

    // The FIFO-by-expiry read: "this user's live, spendable grants."
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_vote_grants_user_expires" ON "roadmap_vote_grants" ("userId", "expiresAt")`,
    );

    // Idempotent issuance: 'monthly'/'daily' grants key on (userId, source, grantKey), so a
    // doubled cron tick or a re-run migration can't double-grant. 'refund' grants carry no
    // grantKey (they're one per vote-removal action, not per period) and are exempt via the
    // partial WHERE clause.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_roadmap_vote_grants_user_source_key"
        ON "roadmap_vote_grants" ("userId", "source", "grantKey")
        WHERE "grantKey" IS NOT NULL
    `);

    // One-time data step — see class docblock.
    await queryRunner.query(`
      INSERT INTO "roadmap_vote_grants" ("userId", "source", "amount", "expiresAt", "grantKey")
      SELECT DISTINCT ug."userId", 'daily', 5, now() + interval '30 days', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      FROM "user_groups" ug
      INNER JOIN "groups" g ON g."id" = ug."groupId"
      WHERE g."name" IN ('SUPER_ADMIN', 'SUPER_DUPER_ADMIN')
      ON CONFLICT ("userId", "source", "grantKey") WHERE "grantKey" IS NOT NULL DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "roadmap_vote_grants"`);
  }
}
