import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforces "100 coins per user per calendar month" on roadmap_allocations.
 *
 * WHY A TRIGGER, when ally-be is the only writer and the service also checks?
 *
 * The cap is a CROSS-ROW invariant — SUM(coins) OVER (userId, periodKey) <= 100 — so no
 * CHECK constraint can express it, and a read-then-write in the service races under
 * Postgres's default READ COMMITTED isolation:
 *
 *     T1: SELECT sum -> 60          T2: SELECT sum -> 60
 *     T1: INSERT coins=40  (ok)     T2: INSERT coins=40  (ok)   -> actual total 140
 *
 * That is not hypothetical for this feature: the coin control is a number input with
 * debounced autosave, so the same human with two tabs open, a double-fired debounce, or
 * an axios retry all produce concurrent writes for the same (userId, periodKey).
 *
 * So there are two layers, on purpose:
 *   1. THIS TRIGGER — the permanent backstop for every writer forever, including the
 *      one-off Supabase import script, a future backfill, and anyone in psql.
 *   2. RoadmapAllocationService.setCoins() takes pg_advisory_xact_lock on
 *      (userId, periodKey) inside its transaction before summing, which makes the
 *      friendly path actually correct rather than usually-correct and lets the API
 *      answer 422 { remaining, cap } instead of surfacing a 500.
 *
 * Rejected service-only alternatives: SELECT ... FOR UPDATE cannot lock the first insert
 * in a period (there are no rows yet), and a separate budget row to lock would be a
 * second thing to keep in sync with the truth.
 *
 * ── THE SELF-EXCLUSION GUARD — read before touching the WHERE clause ──────────────
 * The source function (public.enforce_monthly_cap in the standalone app's schema.sql)
 * excluded the row being written with `opportunity_id != new.opportunity_id`, which was
 * exact there because (user_id, opportunity_id, period_key) WAS the primary key. Here the
 * PK is a surrogate uuid and that triple is a UNIQUE constraint instead, so the exclusion
 * is written against BOTH identities:
 *
 *     "id" IS DISTINCT FROM NEW."id" AND "opportunityId" IS DISTINCT FROM NEW."opportunityId"
 *
 * Get this wrong and an UPDATE double-counts the row it is updating, so raising your own
 * vote from 40 to 60 (with 40 spent elsewhere) fails with a spurious cap error. There is a
 * test named for exactly that case; do not delete it.
 */
export class AddProductRoadmapMonthlyCapTrigger1871000000001 implements MigrationInterface {
  name = 'AddProductRoadmapMonthlyCapTrigger1871000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The message prefix is a contract: RoadmapAllocationService matches on it to map
    // this to a 409/422 rather than a 500. P0001 alone is too generic to key off, since
    // any RAISE EXCEPTION anywhere shares that SQLSTATE.
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
      `DROP TRIGGER IF EXISTS "trg_roadmap_enforce_monthly_cap" ON "roadmap_allocations"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "trg_roadmap_enforce_monthly_cap"
        BEFORE INSERT OR UPDATE ON "roadmap_allocations"
        FOR EACH ROW EXECUTE FUNCTION roadmap_enforce_monthly_cap();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_roadmap_enforce_monthly_cap" ON "roadmap_allocations"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS roadmap_enforce_monthly_cap()`,
    );
  }
}
