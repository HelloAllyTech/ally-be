import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the columns `checkForAndRecordReversals` writes: a finding dismissed
 * as a finder error (`decision_reason` in `not_a_bug` / `wrong_repo` /
 * `duplicate`) that a later finding with the same `repo` + `dedupe_key`
 * proved wrong by actually shipping (MERGED or RELEASED).
 *
 * No new index: the lookup that populates these columns
 * (`findReversibleFinderErrors`) filters on `repo` + `dedupe_key`, already
 * covered by `idx_bug_findings_repo_dedupe_key`.
 *
 * No FK on `reversed_by_finding_id`, matching this table's other
 * self-reference (`parent_finding_id`) — see that column's comment.
 *
 * Hand-written, like every migration on this table — see
 * `1951000000000-AddBugFindingDecisionReason.ts`'s doc for why
 * `migration:generate` must never run against `bug_findings`.
 */
export class AddBugFindingReversal1970200000000 implements MigrationInterface {
  name = 'AddBugFindingReversal1970200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "reversed_by_finding_id" uuid
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "bug_findings"."reversed_at" IS
      'Set when this dismissal was proven wrong by a same-dedupe-key finding later shipping. Null = never dismissed, or dismissed and never contradicted.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "bug_findings"."reversed_by_finding_id" IS
      'The finding that proved this dismissal wrong by shipping. No FK, per this table''s convention for self-references.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      DROP COLUMN IF EXISTS "reversed_by_finding_id",
      DROP COLUMN IF EXISTS "reversed_at"
    `);
  }
}
