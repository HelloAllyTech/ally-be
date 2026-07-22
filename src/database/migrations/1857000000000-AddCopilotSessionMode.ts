import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the copilot operating mode to copilot_sessions. Existing rows are all
 * authoring conversations, so they default to 'BUILDING'; the studio flips a
 * session to 'ITERATING' once the spec is built and the trainer starts giving
 * live-test feedback (see CopilotSessionMode / CopilotSessionService.setMode).
 */
export class AddCopilotSessionMode1857000000000 implements MigrationInterface {
  name = 'AddCopilotSessionMode1857000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "copilot_sessions"
       ADD COLUMN IF NOT EXISTS "mode" character varying NOT NULL DEFAULT 'BUILDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "copilot_sessions" DROP COLUMN IF EXISTS "mode"`,
    );
  }
}
