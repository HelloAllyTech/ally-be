import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveDefaultForBaseEntity1746769768687
  implements MigrationInterface
{
  name = 'RemoveDefaultForBaseEntity1746769768687';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_entries" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_permissions" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "dashboard" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_rooms" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_details" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "call_details" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_rooms" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "dashboard" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_permissions" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_entries" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
  }
}
