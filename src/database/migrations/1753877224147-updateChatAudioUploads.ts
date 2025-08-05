import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateChatAudioUploads1753877224147 implements MigrationInterface {
  name = 'UpdateChatAudioUploads1753877224147';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_audio_uploads" ALTER COLUMN "storageKey" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_audio_uploads" ALTER COLUMN "storageKey" SET NOT NULL`,
    );
  }
}
