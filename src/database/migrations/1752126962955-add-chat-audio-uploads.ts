import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatAudioUploads1752126962955 implements MigrationInterface {
  name = 'AddChatAudioUploads1752126962955';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chat_audio_uploads" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatId" integer NOT NULL, "storageKey" character varying(500) NOT NULL, "status" character varying(50) NOT NULL DEFAULT 'pending', CONSTRAINT "PK_65138da855e5746147643f5f511" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chat_audio_uploads"`);
  }
}
