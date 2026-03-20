import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCharacterMetadataFields1773951243342 implements MigrationInterface {
    name = 'AddCharacterMetadataFields1773951243342'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scenario_characters" ADD "cover_image_url" character varying`);
        await queryRunner.query(`ALTER TABLE "scenario_characters" ADD "cover_video_url" character varying`);
        await queryRunner.query(`ALTER TABLE "scenario_characters" ADD "character_profile_text" character varying(2500)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scenario_characters" DROP COLUMN "character_profile_text"`);
        await queryRunner.query(`ALTER TABLE "scenario_characters" DROP COLUMN "cover_video_url"`);
        await queryRunner.query(`ALTER TABLE "scenario_characters" DROP COLUMN "cover_image_url"`);
    }

}
