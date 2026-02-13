import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthAttemptsTable1770377317384 implements MigrationInterface {
  name = 'CreateAuthAttemptsTable1770377317384';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "auth_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "otp_hash" character varying NOT NULL,
        "magic_token_hash" character varying NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "used_at" TIMESTAMP,
        CONSTRAINT "PK_auth_attempts_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uniq_active_auth_attempt" ON "auth_attempts" ("email") WHERE used = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uniq_active_auth_attempt"`);
    await queryRunner.query(`DROP TABLE "auth_attempts"`);
  }
}
