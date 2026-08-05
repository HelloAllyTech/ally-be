import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Episodic memory (case continuity) storage.
 *
 * ally-ai-learn now emits an end-of-session `session_memory` SQS message:
 * the agent's maintained rolling conversation summary ({summary, language,
 * messageCount, summarizedMessageCount, receivedAt}). It lands on the
 * existing per-session details row (unique on scenarioSessionId, migration
 * 1869) via the same atomic-upsert pattern as the summary and evaluation
 * writers, so arrival order relative to session end does not matter.
 *
 * getPreviousCaseMemory prefers this over summary.feedback.cumulativeMemory:
 * the agent memory exists even when post-session feedback generation fails,
 * and reflects what the live persona actually tracked during the session.
 */
export class AddSessionMemoryToScenarioSessionDetails1885000000000 implements MigrationInterface {
  name = 'AddSessionMemoryToScenarioSessionDetails1885000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_details" ADD COLUMN IF NOT EXISTS "sessionMemory" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_details" DROP COLUMN IF EXISTS "sessionMemory"`,
    );
  }
}
