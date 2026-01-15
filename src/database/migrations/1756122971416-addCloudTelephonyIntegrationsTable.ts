import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCloudTelephonyIntegrationsTable1756122971416 implements MigrationInterface {
  name = 'AddCloudTelephonyIntegrationsTable1756122971416';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cloud_telephony_integrations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying NOT NULL, "credentials" jsonb NOT NULL, "status" character varying NOT NULL DEFAULT 'ACTIVE', "code" character varying NOT NULL, "config" jsonb, CONSTRAINT "UQ_cc7383f56594609644755ac0e49" UNIQUE ("code"), CONSTRAINT "PK_e26b8fc395b1f0037b110bd5b93" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "externalId" text`);
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "externalId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "externalId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "externalId"`);
    await queryRunner.query(`DROP TABLE "cloud_telephony_integrations"`);
  }
}
