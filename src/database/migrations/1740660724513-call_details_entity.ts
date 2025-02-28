import { MigrationInterface, QueryRunner } from 'typeorm';

export class CallDetailsEntity1740660724513 implements MigrationInterface {
  name = 'CallDetailsEntity1740660724513';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "call_details" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "chatId" integer NOT NULL, "callDuration" integer, "startTime" TIMESTAMP, "endTime" TIMESTAMP, "noOfNudges" integer, "noOfStages" integer, "transcript" text, "summary" text, "tags" text, "callOutcome" text, CONSTRAINT "PK_8c35dbba0eaf4351e809d09ab9e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "chatId_idx" ON "call_details" ("chatId") `,
    );
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "summary"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "summary" character varying`,
    );
    await queryRunner.query(`DROP INDEX "public"."chatId_idx"`);
    await queryRunner.query(`DROP TABLE "call_details"`);
  }
}
