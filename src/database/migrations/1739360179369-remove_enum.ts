import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveEnum1739360179369 implements MigrationInterface {
  name = 'RemoveEnum1739360179369';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."chats_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "status" character varying NOT NULL DEFAULT 'ACTIVE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "status"`);
    await queryRunner.query(
      `CREATE TYPE "public"."chats_status_enum" AS ENUM('ACTIVE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "status" "public"."chats_status_enum" NOT NULL DEFAULT 'ACTIVE'`,
    );
  }
}
