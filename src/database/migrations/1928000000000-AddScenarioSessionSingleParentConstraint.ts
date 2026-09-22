import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A scenario session belongs to at most ONE parent: a Scenario Path item, a Case
 * item, or a Track 2.0 item progress row. Every consumer already assumes this —
 * `scenario-session.service.ts` dispatches on the three columns with `if / else if`
 * chains (session start, memory lookup, progress write-back) — but nothing enforced
 * it. `StartScenarioSessionRequestDto` accepts all three fields independently and
 * the start path sets `scenarioPathSessionItemId` unconditionally, so a caller
 * sending two produced a row that the `else if` ladders silently truncate and that
 * any "sessions by type" metric would double-count.
 *
 * Added NOT VALID on purpose: the constraint is enforced for every INSERT and
 * UPDATE from this migration forward, but Postgres skips the full-table scan of
 * existing rows, so a deploy cannot fail on legacy data we have not audited. To
 * find any pre-existing violators:
 *
 *   SELECT id, "scenarioPathSessionItemId", "caseSessionItemId", "trackItemProgressId"
 *   FROM scenario_sessions
 *   WHERE ("scenarioPathSessionItemId" IS NOT NULL)::int
 *       + ("caseSessionItemId" IS NOT NULL)::int
 *       + ("trackItemProgressId" IS NOT NULL)::int > 1;
 *
 * Once that returns zero rows, promote it in a follow-up migration with
 * `ALTER TABLE "scenario_sessions" VALIDATE CONSTRAINT "CHK_scenario_sessions_single_parent"`,
 * which takes only a SHARE UPDATE EXCLUSIVE lock and does not block reads or writes.
 *
 * Sessions with none of the three set are still valid — that is a standalone
 * roleplay, the most common case — so the predicate is `<= 1`, not `= 1`.
 */
export class AddScenarioSessionSingleParentConstraint1928000000000 implements MigrationInterface {
  name = 'AddScenarioSessionSingleParentConstraint1928000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "scenario_sessions"
        DROP CONSTRAINT IF EXISTS "CHK_scenario_sessions_single_parent"
    `);

    await queryRunner.query(`
      ALTER TABLE "scenario_sessions"
        ADD CONSTRAINT "CHK_scenario_sessions_single_parent"
        CHECK (
          ("scenarioPathSessionItemId" IS NOT NULL)::int
          + ("caseSessionItemId" IS NOT NULL)::int
          + ("trackItemProgressId" IS NOT NULL)::int
          <= 1
        )
        NOT VALID
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "scenario_sessions"
        DROP CONSTRAINT IF EXISTS "CHK_scenario_sessions_single_parent"
    `);
  }
}
