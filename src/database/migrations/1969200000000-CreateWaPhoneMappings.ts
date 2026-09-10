import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phone → organisation mappings for the WhatsApp Q&A bot, managed under User Management.
 *
 * The corpus is targeted per organisation (AddKbDocumentAudience1969000000000), so the bot
 * refuses a sender whose organisation it cannot resolve. Until now the only way to resolve
 * one was for the number to appear on somebody's Ally profile — and no screen in the product
 * lets an admin put it there, so the refusal message pointed at an action nobody could
 * perform. This table is that action.
 *
 * `phone_key` — the last ten digits — is the lookup key and carries a PARTIAL unique index on
 * live rows. Unique, because one number resolving to two organisations is precisely the
 * ambiguity the identity rule refuses to guess through; partial, so re-adding a number that
 * was removed inserts a fresh row rather than colliding with the soft-deleted one.
 *
 * NO foreign key to `users`. A mapping must be able to name a number that belongs to nobody
 * with an account — most people this bot serves never log into Ally, and they are the ones
 * this exists for. `user_id` is a nullable snapshot for attribution.
 */
export class CreateWaPhoneMappings1969200000000 implements MigrationInterface {
  name = 'CreateWaPhoneMappings1969200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wa_phone_mappings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone_e164" character varying(32) NOT NULL, "phone_key" character varying(16) NOT NULL, "tenant_id" uuid NOT NULL, "label" text, "user_id" integer, "created_by" integer NOT NULL, "updated_by" integer, "deletedAt" TIMESTAMP, CONSTRAINT "PK_wa_phone_mappings_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_phone_mappings_key" ON "wa_phone_mappings" ("phone_key") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wa_phone_mappings_tenant" ON "wa_phone_mappings" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_wa_phone_mappings_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_wa_phone_mappings_key"`);
    await queryRunner.query(`DROP TABLE "wa_phone_mappings"`);
  }
}
