import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FCM device-token registry (`user_device_tokens`) — one row per (user,
 * device). `token` is globally unique: a device re-registering (e.g. token
 * refresh, or a different user logging into the same device) must not leave
 * duplicate rows pointing at the same physical device.
 */
export class CreateUserDeviceTokens1965000000000 implements MigrationInterface {
  name = 'CreateUserDeviceTokens1965000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_device_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "userId" integer NOT NULL,
        "token" text NOT NULL,
        "platform" character varying(10) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_device_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_device_tokens_token" UNIQUE ("token"),
        CONSTRAINT "CHK_user_device_tokens_platform" CHECK ("platform" IN ('IOS', 'ANDROID'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_device_tokens_user_id" ON "user_device_tokens" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_user_device_tokens_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "user_device_tokens"`);
  }
}
