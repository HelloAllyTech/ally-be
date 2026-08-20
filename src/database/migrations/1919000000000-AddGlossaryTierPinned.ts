import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tierPinned: the admin's override against the computed tier pass. The
 * re-tiering knapsack (tier-assignment.util) never changes a pinned section's
 * injectionMode; a manual mode change through the editor pins automatically,
 * so an admin's explicit choice is never silently recomputed away.
 */
export class AddGlossaryTierPinned1919000000000 implements MigrationInterface {
  name = 'AddGlossaryTierPinned1919000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "language_glossary_sections" ` +
        `ADD COLUMN IF NOT EXISTS "tierPinned" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "language_glossary_sections" DROP COLUMN IF EXISTS "tierPinned"`,
    );
  }
}
