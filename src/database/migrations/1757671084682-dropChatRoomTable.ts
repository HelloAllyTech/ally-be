import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropChatRoomTable1757671084682 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the roomId column from chats table
    await queryRunner.query(
      `ALTER TABLE "chats" DROP COLUMN IF EXISTS "roomId"`,
    );

    // Drop the chat_rooms table
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_rooms"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the chat_rooms table if rollback is needed
    await queryRunner.query(`
      CREATE TABLE "chat_rooms" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
       "id" SERIAL NOT NULL,
        "description" character varying,
        "clientId" integer NOT NULL,
        "counselorId" integer,
        "tenant_id" character varying NOT NULL DEFAULT 'default',
        "metadata" jsonb, CONSTRAINT "PK_c69082bd83bffeb71b0f455bd59" PRIMARY KEY ("id"))
    `);

    // Recreate the roomId column in chats table
    await queryRunner.query(`ALTER TABLE "chats" ADD COLUMN "roomId" integer`);
  }
}
