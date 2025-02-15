import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTables1739281195993 implements MigrationInterface {
  name = 'CreateTables1739281195993';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "name" character varying NOT NULL, "role" character varying NOT NULL, "status" character varying NOT NULL, "username" character varying NOT NULL, "metadata" jsonb, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_token" ("id" SERIAL NOT NULL, "token" character varying NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "deviceInfo" character varying, CONSTRAINT "PK_b575dd3c21fb0831013c909e7fe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("message_id" SERIAL NOT NULL, "chat_id" integer NOT NULL, "sender_id" integer, "type" character varying NOT NULL DEFAULT 'TEXT', "content" character varying NOT NULL, "context" json, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6187089f850b8deeca0232cfeba" PRIMARY KEY ("message_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "chats" ("id" SERIAL NOT NULL, "room_id" integer NOT NULL, "client_id" integer NOT NULL, "counselor_id" integer, "chat_status" character varying NOT NULL DEFAULT 'ACTIVE', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ended_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "summary" character varying, CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_rooms" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "room_id" SERIAL NOT NULL, "client_id" integer NOT NULL, CONSTRAINT "PK_3f26d3daf7f285f061ba377339b" PRIMARY KEY ("room_id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chat_rooms"`);
    await queryRunner.query(`DROP TABLE "chats"`);
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TABLE "refresh_token"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
