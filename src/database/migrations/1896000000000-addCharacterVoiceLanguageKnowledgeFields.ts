import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharacterVoiceLanguageKnowledgeFields1896000000000
  implements MigrationInterface
{
  name = 'AddCharacterVoiceLanguageKnowledgeFields1896000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD "voice_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD "language_characteristics" character varying(1000)`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD "linguistic_style_samples" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD "knowledge_sources" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "knowledge_sources"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "linguistic_style_samples"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "language_characteristics"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "voice_id"`,
    );
  }
}
