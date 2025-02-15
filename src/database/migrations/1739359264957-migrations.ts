import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1739359264957 implements MigrationInterface {
  name = 'Migrations1739359264957';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "queue_entries" ("entry_id" SERIAL NOT NULL, "user_id" integer NOT NULL, "chat_id" integer NOT NULL, "priority" integer NOT NULL DEFAULT '0', "wait_start_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "status" character varying NOT NULL DEFAULT 'WAITING', CONSTRAINT "PK_e5d73cc0e3131ea9667cc9afa08" PRIMARY KEY ("entry_id"))`,
    );
    await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "name"`);
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_rooms" ADD "name" character varying NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE "queue_entries"`);
  }
}
