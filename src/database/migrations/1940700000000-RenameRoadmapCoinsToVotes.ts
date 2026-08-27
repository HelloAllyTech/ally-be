import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rename `roadmap_allocations.coins` → `votes`.
 *
 * Pure terminology fix, not a data-model change: the mechanic (a monthly quota, summed per
 * opportunity into priorityScore, multiple taps accumulating rather than toggling) is
 * unchanged, and 1 coin already equalled 1 vote under that quota — so this is a straight
 * column rename, no value transformation and no backfill.
 *
 * Everything downstream of the column keeps its name: the cap trigger function
 * (roadmap_enforce_monthly_cap, added in migration 1871000000001) is CREATE OR REPLACEd here
 * with its body updated to read/write NEW.votes and SUM(votes), and its exception text
 * updated from "coins" to "votes" — the function and trigger NAMES stay, since they were
 * already neutral. The CHECK constraint enforcing 0 <= votes <= 100 is renamed alongside the
 * column it guards.
 */
export class RenameRoadmapCoinsToVotes1940700000000 implements MigrationInterface {
  name = 'RenameRoadmapCoinsToVotes1940700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_allocations" RENAME COLUMN "coins" TO "votes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_allocations" RENAME CONSTRAINT "CHK_roadmap_allocations_coins" TO "CHK_roadmap_allocations_votes"`,
    );

    // The message prefix is a contract: RoadmapAllocationService matches on it to map this to
    // a 409/422 rather than a 500. P0001 alone is too generic to key off, since any RAISE
    // EXCEPTION anywhere shares that SQLSTATE.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION roadmap_enforce_monthly_cap() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        already int;
        cap     int := 100;
      BEGIN
        SELECT COALESCE(SUM(votes), 0) INTO already
        FROM roadmap_allocations
        WHERE "userId"    = NEW."userId"
          AND "periodKey" = NEW."periodKey"
          AND "id"            IS DISTINCT FROM NEW."id"
          AND "opportunityId" IS DISTINCT FROM NEW."opportunityId";

        IF already + NEW.votes > cap THEN
          RAISE EXCEPTION
            'ROADMAP_MONTHLY_CAP_EXCEEDED: user % already holds % of % votes in %, cannot add %',
            NEW."userId", already, cap, NEW."periodKey", NEW.votes
            USING ERRCODE = 'P0001';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the original function body (from migration 1871000000001) before renaming the
    // column back, so the function is never left referencing a column that does not exist yet.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION roadmap_enforce_monthly_cap() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        already int;
        cap     int := 100;
      BEGIN
        SELECT COALESCE(SUM(coins), 0) INTO already
        FROM roadmap_allocations
        WHERE "userId"    = NEW."userId"
          AND "periodKey" = NEW."periodKey"
          AND "id"            IS DISTINCT FROM NEW."id"
          AND "opportunityId" IS DISTINCT FROM NEW."opportunityId";

        IF already + NEW.coins > cap THEN
          RAISE EXCEPTION
            'ROADMAP_MONTHLY_CAP_EXCEEDED: user % already holds % of % coins in %, cannot add %',
            NEW."userId", already, cap, NEW."periodKey", NEW.coins
            USING ERRCODE = 'P0001';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "roadmap_allocations" RENAME CONSTRAINT "CHK_roadmap_allocations_votes" TO "CHK_roadmap_allocations_coins"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_allocations" RENAME COLUMN "votes" TO "coins"`,
    );
  }
}
