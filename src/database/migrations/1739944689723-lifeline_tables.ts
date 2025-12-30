import { MigrationInterface, QueryRunner } from 'typeorm';

export class LifelineTables1739944689723 implements MigrationInterface {
  name = 'LifelineTables1739944689723';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "name" character varying NOT NULL, "role" character varying NOT NULL, "status" character varying NOT NULL, "username" character varying NOT NULL, "metadata" jsonb, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_token" ("id" SERIAL NOT NULL, "token" character varying NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "deviceInfo" character varying, CONSTRAINT "PK_b575dd3c21fb0831013c909e7fe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "queue_entries" ("entry_id" SERIAL NOT NULL, "user_id" integer NOT NULL, "chat_id" integer NOT NULL, "priority" integer NOT NULL DEFAULT '0', "wait_start_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "status" character varying NOT NULL DEFAULT 'WAITING', CONSTRAINT "PK_e5d73cc0e3131ea9667cc9afa08" PRIMARY KEY ("entry_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "chatId" integer NOT NULL, "senderId" integer, "type" character varying NOT NULL, "content" character varying NOT NULL, "context" character varying, "metadata" jsonb, CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "feedback" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "feedbackId" SERIAL NOT NULL, "modifiedContent" character varying, "rating" double precision, "messageId" integer NOT NULL, "userId" integer NOT NULL, CONSTRAINT "PK_3b500d42f7115ffdbfd1190b2e0" PRIMARY KEY ("feedbackId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "message_id_index" ON "feedback" ("messageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "user_id_index" ON "feedback" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chats" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "roomId" integer NOT NULL, "clientId" integer NOT NULL, "counselorId" integer, "status" character varying NOT NULL DEFAULT 'ACTIVE', "startedAt" TIMESTAMP, "endedAt" TIMESTAMP, "summary" character varying, CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_rooms" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "description" character varying, "clientId" integer NOT NULL, "counselorId" integer, "metadata" jsonb, CONSTRAINT "PK_c69082bd83bffeb71b0f455bd59" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chat_rooms"`);
    await queryRunner.query(`DROP TABLE "chats"`);
    await queryRunner.query(`DROP INDEX "public"."user_id_index"`);
    await queryRunner.query(`DROP INDEX "public"."message_id_index"`);
    await queryRunner.query(`DROP TABLE "feedback"`);
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TABLE "queue_entries"`);
    await queryRunner.query(`DROP TABLE "refresh_token"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
