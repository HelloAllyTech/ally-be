import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces roadmap_enforce_monthly_cap() (migration 1871000000001) with a trigger that
 * validates against the vote-grant ledger (1962000000000) instead of a flat 100/month cap.
 *
 * SAME TWO-LAYER REASONING AS BEFORE, unchanged: ally-be is the only writer, but this trigger
 * is the permanent backstop for every writer forever — a future one-off script, a backfill, or
 * anyone in psql — while RoadmapAllocationService's advisory lock is what makes the friendly
 * path actually correct (a clean 422) rather than usually-correct. Neither layer alone is
 * sufficient, for the exact same READ COMMITTED race the old trigger's docblock explains.
 *
 * WHAT CHANGED: the old trigger summed OTHER ROWS IN roadmap_allocations and compared against
 * a fixed cap. This one compares the WRITE'S OWN DELTA against a live balance read from
 * roadmap_vote_grants — there's no fixed cap to sum against anymore, since the grant ledger
 * accrues continuously (daily + monthly) rather than resetting to a flat number each period.
 *
 * ── ORDERING MATTERS — read before touching RoadmapAllocationService.setVotes() ──────────
 * This trigger only VALIDATES; it never touches roadmap_vote_grants itself (spending is the
 * service's job, via RoadmapVoteGrantRepository.consume()). For that to stay correct, the
 * service MUST write the roadmap_allocations row BEFORE calling consume(): this trigger reads
 * "available" as SUM(amount - consumed) across live grants at the instant it fires, and if
 * consume() had already run, that same spend would already be subtracted from "available",
 * double-counting the request against itself and rejecting a legitimate vote. Same class of
 * ordering subtlety as the old trigger's self-exclusion guard — get it backwards and casting a
 * vote fails exactly when the balance is tightest, which is the case most likely to go
 * unnoticed in testing and bite for real.
 *
 * A decrease (TG_OP='UPDATE' with NEW.votes < OLD.votes, or any DELETE-shaped path) never
 * needs validating — freeing votes up can't breach a balance — so the delta check only runs
 * for a positive delta.
 */
export class AddRoadmapVoteGrantBalanceTrigger1962100000000 implements MigrationInterface {
  name = 'AddRoadmapVoteGrantBalanceTrigger1962100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old cap trigger and function — superseded, not needed alongside this one.
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_roadmap_enforce_monthly_cap" ON "roadmap_allocations"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS roadmap_enforce_monthly_cap()`,
    );

    // CHK_roadmap_allocations_votes capped a single row at 100 — correct only while 100 was
    // also the fixed monthly ceiling every user's WHOLE balance was bound by. Under the grant
    // ledger a balance keeps accruing (daily + monthly, each good for 30 days), so one
    // opportunity can legitimately hold more than 100 votes from one person over time. The
    // real ceiling is now fully owned by roadmap_enforce_vote_grant_balance() below; this
    // column only needs to stay non-negative.
    await queryRunner.query(
      `ALTER TABLE "roadmap_allocations" DROP CONSTRAINT "CHK_roadmap_allocations_votes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_allocations" ADD CONSTRAINT "CHK_roadmap_allocations_votes" CHECK ("votes" >= 0)`,
    );

    // The message prefix is a contract: RoadmapAllocationService matches on it to map this to
    // a 422 rather than a 500. P0001 alone is too generic to key off, since any RAISE
    // EXCEPTION anywhere shares that SQLSTATE.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION roadmap_enforce_vote_grant_balance() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        delta     int;
        available int;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          delta := NEW.votes;
        ELSE
          delta := NEW.votes - OLD.votes;
        END IF;

        IF delta <= 0 THEN
          RETURN NEW;
        END IF;

        SELECT COALESCE(SUM("amount" - "consumed"), 0) INTO available
        FROM roadmap_vote_grants
        WHERE "userId" = NEW."userId" AND "expiresAt" > now();

        IF delta > available THEN
          RAISE EXCEPTION
            'ROADMAP_VOTE_BALANCE_EXCEEDED: user % wants % more votes but only % are available',
            NEW."userId", delta, available
            USING ERRCODE = 'P0001';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_roadmap_enforce_vote_grant_balance" ON "roadmap_allocations"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "trg_roadmap_enforce_vote_grant_balance"
        BEFORE INSERT OR UPDATE ON "roadmap_allocations"
        FOR EACH ROW EXECUTE FUNCTION roadmap_enforce_vote_grant_balance();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_roadmap_enforce_vote_grant_balance" ON "roadmap_allocations"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS roadmap_enforce_vote_grant_balance()`,
    );
    // Note: does NOT restore CHK_roadmap_allocations_votes's old `<= 100` bound either —
    // by rollback time a row may legitimately hold more than 100 votes (that's the whole
    // point of the ledger this migration enables), and re-adding a CHECK that some existing
    // row now violates would fail the migration outright. `votes >= 0` stays in place.
    //
    // Note: does NOT restore roadmap_enforce_monthly_cap() — that function/trigger pair is
    // gone for good once this migration's `up` has run. A rollback that needs the old flat
    // cap back should revert to before 1871000000001 was itself altered, not rely on this
    // migration's `down` to resurrect it.
  }
}
