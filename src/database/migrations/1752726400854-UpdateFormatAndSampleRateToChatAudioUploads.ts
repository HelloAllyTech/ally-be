import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateFormatAndSampleRateToChatAudioUploads1752726400854 implements MigrationInterface {
  name = 'UpdateFormatAndSampleRateToChatAudioUploads1752726400854';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_audio_uploads" ADD "sampleRate" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_audio_uploads" ADD "format" character varying(50)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_audio_uploads" DROP COLUMN "format"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_audio_uploads" DROP COLUMN "sampleRate"`,
    );
  }
}
