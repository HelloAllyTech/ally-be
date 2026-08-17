import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-prompt "offer this in the studio picker" switch.
 *
 * This is a FUTURE-VISIBILITY flag, not a capability kill switch. Turning a
 * skill off removes it from the Skill Version / evaluator dropdowns so no NEW
 * simulation can be pointed at it; every scenario already carrying its
 * promptCode in `metadata.selectedMainPromptCode` (or
 * `selectedEvaluatorPromptCode`) keeps resolving and running on it untouched.
 * Nothing in the runtime path reads this column — that is deliberate, and it
 * is what makes hiding non-breaking. `GET /prompts/by-type/:type` also keeps
 * returning hidden rows so the studio can still resolve a hidden-but-in-use
 * variant's name, states and available variables; only the two pickers that
 * offer a *choice* filter on the flag.
 *
 * DEFAULT true with no backfill: every existing prompt stays visible, so this
 * migration changes nothing until an admin deliberately switches something off.
 * Distinct from `isObsolete`, which is owned by the file-sync lifecycle
 * (prompts whose .txt disappeared) and gates deletion — overloading it would
 * mean an admin hiding a variant made it deletable.
 */
export class AddVisibleInStudioToPrompts1903000000000
  implements MigrationInterface
{
  name = 'AddVisibleInStudioToPrompts1903000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prompts"
        ADD COLUMN "visibleInStudio" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prompts" DROP COLUMN "visibleInStudio"
    `);
  }
}
