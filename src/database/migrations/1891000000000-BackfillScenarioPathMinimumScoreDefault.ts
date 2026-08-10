import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Same bug as BackfillRoleplayMinScoreDefault1890000000000, in the older
 * Learning Pathway system: `scenario_path_items.minimumScore` is a plain
 * nullable int column (not jsonb), and the admin builder
 * (SimulationSelection.tsx / SimulationItem.tsx) pre-seeds every newly added
 * simulation with `minimumScore: 0`. scenario-path-session.service.ts
 * `handleEndScenarioPathSession` treats that as a real "score >= 0" gate, so
 * any learner whose score goes negative is permanently unable to unlock the
 * next simulation in the path — even though the admin never configured a
 * minimum. Clears the stale 0 back to NULL, which the service already
 * handles correctly (see the accompanying `!== null` guard fix).
 *
 * Idempotent (only matches rows currently at exactly 0).
 */
export class BackfillScenarioPathMinimumScoreDefault1891000000000 implements MigrationInterface {
  name = 'BackfillScenarioPathMinimumScoreDefault1891000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "scenario_path_items"
      SET "minimumScore" = NULL
      WHERE "minimumScore" = 0
    `);
  }

  public async down(): Promise<void> {
    // Intentional no-op: cannot distinguish a stripped accidental default of
    // 0 from a row that never had minimumScore set in the first place.
  }
}
