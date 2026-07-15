import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Test-case-driven rehearsals: transcript rows produced by an agent-test-case
 * (CONDITION_DRIVEN) session carry the case id and the evaluator's verdict.
 *  - agentTestCaseId — uuid, nullable, deliberately NO FK: agent_test_cases
 *    is global + hard-deleted; the run's config.testCases snapshot keeps
 *    historical runs self-describing.
 *  - testCaseResult  — jsonb verdict object { test_case_id, title, verdict,
 *    condition_recreated, evidence, reasoning }.
 */
export class AddTestCaseColumnsToRehearsalTranscripts1821000000000 implements MigrationInterface {
  name = 'AddTestCaseColumnsToRehearsalTranscripts1821000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rehearsal_transcripts" ADD "agentTestCaseId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "rehearsal_transcripts" ADD "testCaseResult" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rehearsal_transcripts" DROP COLUMN "testCaseResult"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rehearsal_transcripts" DROP COLUMN "agentTestCaseId"`,
    );
  }
}
