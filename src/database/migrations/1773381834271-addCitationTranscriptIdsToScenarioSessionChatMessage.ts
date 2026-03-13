import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCitationTranscriptIdsToScenarioSessionChatMessage1773381834271 implements MigrationInterface {
  name = 'AddCitationTranscriptIdsToScenarioSessionChatMessage1773381834271';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_chat_messages" ADD "citationTranscriptIds" integer array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_chat_messages" DROP COLUMN "citationTranscriptIds"`,
    );
  }
}
