import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddsTenant1746530266127 implements MigrationInterface {
  name = 'AddsTenant1746530266127';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tenants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "code" character varying NOT NULL, "description" text, "status" character varying NOT NULL DEFAULT 'ACTIVE', "metadata" jsonb, "settings" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_32731f181236a46182a38c992a8" UNIQUE ("name"), CONSTRAINT "UQ_3021c18db2b363ae9324c826c5a" UNIQUE ("code"), CONSTRAINT "PK_53be67a04681c66b87ee27c9321" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "groups" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_permissions" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "dashboard" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_rooms" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_details" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "call_details" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(`ALTER TABLE "chat_rooms" DROP COLUMN "tenant_id"`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "tenant_id"`);
    await queryRunner.query(`ALTER TABLE "dashboard" DROP COLUMN "tenant_id"`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP COLUMN "tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE "group_permissions" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "tenant_id"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE "user_groups" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "tenants"`);
  }
}
