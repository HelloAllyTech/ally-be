import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Link a WhatsApp contact to an Ally user and organisation.
 *
 * `wa_contacts` was deliberately not a user record: the bot is open to anyone with the
 * number, so a phone number plus consent state was all it needed. That holds only while
 * the corpus is global to everyone. Now that a document can be targeted at particular
 * organisations (see AddKbDocumentAudience1969000000000), answering a question means
 * knowing which organisation is asking, and the number is the only identifier WhatsApp
 * gives us.
 *
 * Every column is NULLABLE and no backfill is possible or attempted. Resolution happens
 * per inbound message by matching the sender's number against `users.phone`, so existing
 * contacts are linked the next time they message rather than by a migration guessing on
 * their behalf. A contact that stays unlinked is answered with an explicit "we can't
 * recognise this number" reply — not from the global corpus, which was the alternative
 * and would have quietly given every unrecognised number a different answer to the same
 * question than a recognised one gets.
 *
 * `tenant_id` is varchar, matching `users.tenant_id`, which this copies from. The
 * platform spells that column both ways — `kb_document_tenants.tenant_id` is a uuid —
 * and taking the source's type is what keeps the per-message comparison cast-free.
 */
export class AddWaContactIdentity1969100000000 implements MigrationInterface {
  name = 'AddWaContactIdentity1969100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wa_contacts" ADD "user_id" integer`);
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" ADD "tenant_id" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" ADD "identified_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" ADD "identity_source" character varying(16)`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_wa_contacts_user" ON "wa_contacts" ("user_id")`,
    );
    // Indexed because the usage dashboard breaks answered/unanswered volume down by
    // organisation, which is the number an account manager is asked for.
    await queryRunner.query(
      `CREATE INDEX "idx_wa_contacts_tenant" ON "wa_contacts" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_wa_contacts_tenant"`);
    await queryRunner.query(`DROP INDEX "public"."idx_wa_contacts_user"`);
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" DROP COLUMN "identity_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" DROP COLUMN "identified_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(`ALTER TABLE "wa_contacts" DROP COLUMN "user_id"`);
  }
}
