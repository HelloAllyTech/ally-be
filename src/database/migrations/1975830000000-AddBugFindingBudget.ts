import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The budget on a bug's case file (OPP-0775): caps and spend for fix
 * sessions, attempts, escalations, dollars and minutes, as one jsonb blob —
 * see `src/bug-hunter/type/bug-case-budget.type.ts` for the shape and why it
 * is one column rather than ten.
 *
 * Nullable with no backfill: a null budget reads as "defaults, nothing spent",
 * which is true of every existing row as far as the new counters are
 * concerned. Spend that happened before this migration is not reconstructed;
 * the counters start now.
 */
export class AddBugFindingBudget1975830000000 implements MigrationInterface {
  name = 'AddBugFindingBudget1975830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD COLUMN IF NOT EXISTS "budget" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP COLUMN IF EXISTS "budget"`,
    );
  }
}
