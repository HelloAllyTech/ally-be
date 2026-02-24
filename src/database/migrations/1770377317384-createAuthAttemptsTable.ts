import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthAttemptsTable1770377317384 implements MigrationInterface {
  name = 'CreateAuthAttemptsTable1770377317384';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "auth_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "otpHash" character varying NOT NULL,
        "magicTokenHash" character varying NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "usedAt" TIMESTAMP,
        CONSTRAINT "PK_auth_attempts_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_auth_attempts_email_idx" ON "auth_attempts" ("email") WHERE used = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_auth_attempts_email_idx"`);
    await queryRunner.query(`DROP TABLE "auth_attempts"`);
  }
}
