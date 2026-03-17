import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharacterMetadataFields1773659999999 implements MigrationInterface {
  name = 'AddCharacterMetadataFields1773659999999';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters"
        ADD COLUMN IF NOT EXISTS "cover_image_url" character varying,
        ADD COLUMN IF NOT EXISTS "cover_video_url" character varying,
        ADD COLUMN IF NOT EXISTS "character_profile_text" character varying(2500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters"
        DROP COLUMN IF EXISTS "character_profile_text",
        DROP COLUMN IF EXISTS "cover_video_url",
        DROP COLUMN IF EXISTS "cover_image_url"`,
    );
  }
}
