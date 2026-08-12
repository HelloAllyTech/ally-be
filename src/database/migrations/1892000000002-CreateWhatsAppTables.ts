import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The WhatsApp Q&A bot's five tables, created together.
 *
 * One migration rather than five because they are meaningless apart — a contact with no message
 * table is not a deployable intermediate state — and because splitting them would put five
 * consecutive prefixes on what is one schema change.
 *
 * Two indexes here are load-bearing rather than performance tuning:
 *
 *  - `uq_wa_messages_provider_id` IS the bot's deduplication mechanism. SQS is at-least-once and
 *    Meta retries webhooks independently, so an `INSERT ... ON CONFLICT DO NOTHING` against this
 *    index, run as the consumer's first statement, is the only thing preventing a worker being
 *    answered twice.
 *  - `uq_wa_unanswered_message` stops a redelivery double-filing the same corpus gap.
 *
 * No tenant columns anywhere: the bot is open to anyone with the number.
 */
export class CreateWhatsAppTables1892000000002 implements MigrationInterface {
  name = 'CreateWhatsAppTables1892000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── contacts ──────────────────────────────────────────────────────────
    // `phone_e164` is plaintext and identifiable data about mental healthcare workers. Stored as an
    // explicit decision (it is what lets an admin follow up on a crisis message or block an abuser);
    // masked to `phone_last4` everywhere in the admin UI.
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "wa_contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "phone_e164" character varying(32) NOT NULL,
        "phone_last4" character varying(4) NOT NULL,
        "consent_status" character varying(16) NOT NULL DEFAULT 'pending',
        "consent_granted_at" TIMESTAMP,
        "opted_out_at" TIMESTAMP,
        "first_seen_at" TIMESTAMP NOT NULL DEFAULT now(),
        "last_seen_at" TIMESTAMP NOT NULL DEFAULT now(),
        "message_count" integer NOT NULL DEFAULT 0,
        "locale" character varying(16),
        "blocked_at" TIMESTAMP,
        "blocked_reason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wa_contacts" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_wa_contacts_phone"
        ON "wa_contacts" ("phone_e164")`,
    );

    // ── conversations ─────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "wa_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "contact_id" uuid NOT NULL,
        "started_at" TIMESTAMP NOT NULL DEFAULT now(),
        "last_message_at" TIMESTAMP NOT NULL DEFAULT now(),
        "message_count" integer NOT NULL DEFAULT 0,
        "last_language" character varying(16),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wa_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wa_conversations_contact"
          FOREIGN KEY ("contact_id") REFERENCES "wa_contacts"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_conversations_contact"
        ON "wa_conversations" ("contact_id", "last_message_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_conversations_last_message"
        ON "wa_conversations" ("last_message_at" DESC)`,
    );

    // ── messages ──────────────────────────────────────────────────────────
    // No FK on conversation_id: the consumer claims `provider_message_id` with an INSERT before it
    // knows the contact or thread (dedupe has to be the first statement), so the row briefly holds
    // placeholder ids. A FK would reject that insert and break dedupe.
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "wa_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL,
        "direction" character varying(16) NOT NULL,
        "provider_message_id" character varying(128),
        "body" text NOT NULL,
        "language" character varying(16),
        "handled_by" character varying(24),
        "template_id" uuid,
        "citations" jsonb,
        "retrieval_meta" jsonb,
        "latency_ms" integer,
        "status" character varying(16) NOT NULL DEFAULT 'received',
        "error_message" text,
        "in_reply_to_id" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wa_messages" PRIMARY KEY ("id")
      )`,
    );
    // THE dedupe index. Partial so the many outbound rows with a NULL provider id (a send that failed
    // before the provider accepted it) do not sit in it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_wa_messages_provider_id"
        ON "wa_messages" ("provider_message_id")
        WHERE "provider_message_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_messages_conversation"
        ON "wa_messages" ("conversation_id", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_messages_contact"
        ON "wa_messages" ("contact_id", "createdAt" DESC)`,
    );
    // Drives the outcome mix on the dashboard — answered vs declined vs crisis vs template.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_messages_handled_by"
        ON "wa_messages" ("handled_by", "createdAt" DESC)`,
    );

    // ── keyword templates ─────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "wa_keyword_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying(16) NOT NULL,
        "name" text NOT NULL,
        "match_type" character varying(16) NOT NULL DEFAULT 'any_of',
        "patterns" text array NOT NULL DEFAULT '{}',
        "language_code" character varying(16),
        "priority" integer NOT NULL DEFAULT 300,
        "response_text" text NOT NULL,
        "bypass_rag" boolean NOT NULL DEFAULT true,
        "terminal" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "mandatory" boolean NOT NULL DEFAULT false,
        "archived_at" TIMESTAMP,
        "created_by" integer,
        "updated_by" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wa_keyword_templates" PRIMARY KEY ("id")
      )`,
    );
    // The matcher loads active rules in (priority, createdAt) order on every message, so this index
    // is the hot path for the whole bot.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_keyword_templates_priority"
        ON "wa_keyword_templates" ("priority", "createdAt")
        WHERE "active" = true AND "archived_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_keyword_templates_kind"
        ON "wa_keyword_templates" ("kind")`,
    );

    // ── unanswered questions ──────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "wa_unanswered_questions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "message_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "question_text" text NOT NULL,
        "language" character varying(16),
        "reason" character varying(24) NOT NULL,
        "top_similarity" numeric(6,4),
        "hit_count" integer NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'open',
        "assigned_to" integer,
        "resolution_note" text,
        "linked_document_id" uuid,
        "resolved_by" integer,
        "resolved_at" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wa_unanswered_questions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_wa_unanswered_message"
        ON "wa_unanswered_questions" ("message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_unanswered_status"
        ON "wa_unanswered_questions" ("status", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_wa_unanswered_reason"
        ON "wa_unanswered_questions" ("reason", "createdAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "wa_unanswered_questions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wa_keyword_templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wa_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wa_conversations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wa_contacts"`);
  }
}
