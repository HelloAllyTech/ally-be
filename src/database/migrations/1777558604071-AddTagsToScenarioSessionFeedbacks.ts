import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTagsToScenarioSessionFeedbacks1777500000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_feedbacks"
       ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_feedbacks" DROP COLUMN IF EXISTS "tags"`,
    );
  }
}
