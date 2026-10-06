import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The text helpline's whole schema (docs/text-helpline.md §4), in one go so the
 * copilot / QA / supervision pass that follows needs no schema change.
 *
 * Hand-written SQL, never `migration:generate`: every enum column is a varchar
 * with a hand-written CHECK (the `bug_findings` precedent), which TypeORM
 * cannot see and would propose dropping. `check-constraints-cover-enums.spec.ts`
 * compares each CHECK below with its TypeScript enum.
 *
 * Two constraints carry product invariants rather than enums:
 *  - `CHK_helpline_messages_talker_visibility` — only TEXT and SYSTEM rows may
 *    ever be talker-visible. Whispers, suggestions, nudges, stages, risk and
 *    transfer rows cannot be marked visible even by a bug in the serialiser.
 *  - the partial unique index on `(chat_id, client_message_id)` — a resend of
 *    the same client message is the same row, never a second one.
 *
 * Timestamps are `timestamptz` throughout: the lifecycle sweep compares them
 * with `now()` across replicas, and a zone-less column would make that depend
 * on each container's TZ.
 */
export class CreateTextHelpline1975740000000 implements MigrationInterface {
  name = 'CreateTextHelpline1975740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_talkers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "channel" character varying(16) NOT NULL DEFAULT 'TEXT_WEB',
        "display_name" character varying(40) NOT NULL DEFAULT 'Anonymous',
        "language" character varying(8) NOT NULL,
        "consent_version" character varying(32) NOT NULL,
        "consent_accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ip_hash" character varying(64),
        "user_agent" character varying(255),
        "last_seen_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "blocked_at" TIMESTAMP WITH TIME ZONE,
        "blocked_by" integer,
        "erased_at" TIMESTAMP WITH TIME ZONE,
        "wa_contact_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_talkers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_helpline_talkers_channel" CHECK ("channel" IN ('TEXT_WEB','TEXT_WHATSAPP'))
      )
    `);
    // The 24 h block window and per-ip abuse lookups.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_talkers_tenant_ip_hash" ON "helpline_talkers" ("tenant_id", "ip_hash") WHERE "ip_hash" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_chats" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "talker_id" uuid NOT NULL,
        "channel" character varying(16) NOT NULL DEFAULT 'TEXT_WEB',
        "status" character varying(16) NOT NULL DEFAULT 'WAITING',
        "language" character varying(8) NOT NULL,
        "priority" integer NOT NULL DEFAULT 0,
        "wait_started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "abandoned_at" TIMESTAMP WITH TIME ZONE,
        "claimed_at" TIMESTAMP WITH TIME ZONE,
        "listener_id" integer,
        "previous_listener_ids" integer[] NOT NULL DEFAULT '{}',
        "transfer_requested_at" TIMESTAMP WITH TIME ZONE,
        "transfer_requested_by" integer,
        "transfer_target_listener_id" integer,
        "taken_over_at" TIMESTAMP WITH TIME ZONE,
        "ended_at" TIMESTAMP WITH TIME ZONE,
        "ended_reason" character varying(32),
        "ended_by" integer,
        "risk_level" character varying(16) NOT NULL DEFAULT 'NONE',
        "resources_sent_at" TIMESTAMP WITH TIME ZONE,
        "last_talker_message_at" TIMESTAMP WITH TIME ZONE,
        "last_listener_message_at" TIMESTAMP WITH TIME ZONE,
        "talker_message_count" integer NOT NULL DEFAULT 0,
        "listener_message_count" integer NOT NULL DEFAULT 0,
        "talker_turns_since_nudge" integer NOT NULL DEFAULT 0,
        "nudge_count" integer NOT NULL DEFAULT 0,
        "qa_status" character varying(16),
        "erased_at" TIMESTAMP WITH TIME ZONE,
        "metadata" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_chats" PRIMARY KEY ("id"),
        CONSTRAINT "FK_helpline_chats_talker" FOREIGN KEY ("talker_id") REFERENCES "helpline_talkers"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_helpline_chats_channel" CHECK ("channel" IN ('TEXT_WEB','TEXT_WHATSAPP')),
        CONSTRAINT "CHK_helpline_chats_status" CHECK ("status" IN ('WAITING','ACTIVE','ENDED')),
        CONSTRAINT "CHK_helpline_chats_ended_reason" CHECK ("ended_reason" IS NULL OR "ended_reason" IN ('LISTENER_ENDED','TALKER_ENDED','TALKER_LEFT_QUEUE','TALKER_DISCONNECTED','WAIT_EXPIRED','QUEUE_ABANDONED','SUPERVISOR_ENDED','TALKER_ERASED','TALKER_BLOCKED')),
        CONSTRAINT "CHK_helpline_chats_risk_level" CHECK ("risk_level" IN ('NONE','ELEVATED','HIGH')),
        CONSTRAINT "CHK_helpline_chats_qa_status" CHECK ("qa_status" IS NULL OR "qa_status" IN ('PENDING','DONE','SKIPPED','FAILED')),
        CONSTRAINT "CHK_helpline_chats_counts" CHECK ("talker_message_count" >= 0 AND "listener_message_count" >= 0 AND "nudge_count" >= 0)
      )
    `);
    // The lobby: priority desc, then oldest wait first.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_chats_queue" ON "helpline_chats" ("tenant_id", "status", "priority" DESC, "wait_started_at")`,
    );
    // "My active chats" and the claim's capacity check.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_chats_listener" ON "helpline_chats" ("tenant_id", "listener_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_chats_talker" ON "helpline_chats" ("talker_id")`,
    );
    // The retention sweep's candidate scan.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_chats_retention" ON "helpline_chats" ("tenant_id", "ended_at") WHERE "erased_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_messages" (
        "id" SERIAL NOT NULL,
        "tenant_id" character varying NOT NULL,
        "chat_id" uuid NOT NULL,
        "sender_role" character varying(16) NOT NULL,
        "sender_user_id" integer,
        "type" character varying(16) NOT NULL,
        "system_kind" character varying(40),
        "content" text NOT NULL,
        "parent_message_id" integer,
        "client_message_id" uuid,
        "visible_to_talker" boolean NOT NULL DEFAULT false,
        "metadata" jsonb,
        "erased_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_helpline_messages_chat" FOREIGN KEY ("chat_id") REFERENCES "helpline_chats"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_helpline_messages_sender_role" CHECK ("sender_role" IN ('TALKER','LISTENER','SUPERVISOR','SYSTEM','COPILOT')),
        CONSTRAINT "CHK_helpline_messages_type" CHECK ("type" IN ('TEXT','SYSTEM','SUGGESTION','NUDGE','STAGE','RISK','WHISPER','TRANSFER')),
        CONSTRAINT "CHK_helpline_messages_talker_visibility" CHECK ("type" IN ('TEXT','SYSTEM') OR "visible_to_talker" = false)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_messages_chat_id" ON "helpline_messages" ("chat_id", "id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_helpline_messages_chat_client_message" ON "helpline_messages" ("chat_id", "client_message_id") WHERE "client_message_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_listener_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "user_id" integer NOT NULL,
        "display_name" character varying(40) NOT NULL,
        "max_concurrent_chats" integer NOT NULL DEFAULT 2,
        "languages" text[] NOT NULL DEFAULT '{}',
        "notifications_enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_listener_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_helpline_listener_profiles_user" UNIQUE ("user_id"),
        CONSTRAINT "CHK_helpline_listener_profiles_max_concurrent" CHECK ("max_concurrent_chats" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_risk_keyword_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying,
        "phrase" character varying(200) NOT NULL,
        "language" character varying(8) NOT NULL,
        "match_type" character varying(16) NOT NULL,
        "level" character varying(16) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_risk_keyword_rules" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_helpline_risk_keyword_rules_match_type" CHECK ("match_type" IN ('CONTAINS','WORD')),
        CONSTRAINT "CHK_helpline_risk_keyword_rules_level" CHECK ("level" IN ('ELEVATED','HIGH'))
      )
    `);
    // One rule per phrase per scope; NULL tenant (platform default) is a scope of its own.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_helpline_risk_keyword_rules_scope_phrase" ON "helpline_risk_keyword_rules" ((COALESCE("tenant_id", '')), "language", "phrase")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_risk_flags" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "chat_id" uuid NOT NULL,
        "message_id" integer NOT NULL,
        "level" character varying(16) NOT NULL,
        "source" character varying(16) NOT NULL,
        "confidence" real,
        "subject" character varying(16),
        "rule_id" uuid,
        "signal_start" integer,
        "signal_end" integer,
        "resources_sent" boolean NOT NULL DEFAULT false,
        "acknowledged_by" integer,
        "acknowledged_at" TIMESTAMP WITH TIME ZONE,
        "outcome" character varying(16) NOT NULL DEFAULT 'UNREVIEWED',
        "outcome_note" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_risk_flags" PRIMARY KEY ("id"),
        CONSTRAINT "FK_helpline_risk_flags_chat" FOREIGN KEY ("chat_id") REFERENCES "helpline_chats"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_helpline_risk_flags_message" FOREIGN KEY ("message_id") REFERENCES "helpline_messages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_helpline_risk_flags_rule" FOREIGN KEY ("rule_id") REFERENCES "helpline_risk_keyword_rules"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_helpline_risk_flags_level" CHECK ("level" IN ('ELEVATED','HIGH')),
        CONSTRAINT "CHK_helpline_risk_flags_source" CHECK ("source" IN ('KEYWORD','CLASSIFIER')),
        CONSTRAINT "CHK_helpline_risk_flags_subject" CHECK ("subject" IS NULL OR "subject" IN ('SELF','OTHER','UNCLEAR')),
        CONSTRAINT "CHK_helpline_risk_flags_outcome" CHECK ("outcome" IN ('UNREVIEWED','CONFIRMED','FALSE_POSITIVE')),
        CONSTRAINT "CHK_helpline_risk_flags_offsets" CHECK ("signal_start" IS NULL OR ("signal_start" >= 0 AND "signal_end" >= "signal_start"))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_risk_flags_chat" ON "helpline_risk_flags" ("tenant_id", "chat_id")`,
    );
    // The calibration view (`?days=7`).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_risk_flags_created" ON "helpline_risk_flags" ("tenant_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_chat_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "chat_id" uuid NOT NULL,
        "type" character varying(32) NOT NULL,
        "actor_user_id" integer,
        "payload" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_chat_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_helpline_chat_events_chat" FOREIGN KEY ("chat_id") REFERENCES "helpline_chats"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_helpline_chat_events_type" CHECK ("type" IN ('ENQUEUED','CLAIMED','TALKER_DISCONNECTED','TALKER_RECONNECTED','LISTENER_DISCONNECTED','LISTENER_RECONNECTED','TRANSFER_REQUESTED','TRANSFERRED','ASSIGNED','TAKEN_OVER','RESOURCES_SENT','RISK_FLAGGED','RISK_ACKNOWLEDGED','SUPERVISOR_ALERTED','ENDED','ERASURE_REQUESTED','TALKER_BLOCKED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_chat_events_chat" ON "helpline_chat_events" ("chat_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_chat_summaries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "chat_id" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "fields" jsonb NOT NULL DEFAULT '{}',
        "through_message_id" integer NOT NULL DEFAULT 0,
        "edited_by" integer,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_chat_summaries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_helpline_chat_summaries_chat_kind" UNIQUE ("chat_id", "kind"),
        CONSTRAINT "FK_helpline_chat_summaries_chat" FOREIGN KEY ("chat_id") REFERENCES "helpline_chats"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_helpline_chat_summaries_kind" CHECK ("kind" IN ('ROLLING','HANDOFF','FINAL'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_qa_scores" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "chat_id" uuid NOT NULL,
        "listener_id" integer NOT NULL,
        "rubric_version" character varying(64) NOT NULL,
        "levels" jsonb NOT NULL DEFAULT '{}',
        "verdicts" jsonb NOT NULL DEFAULT '{}',
        "composite_score" real NOT NULL,
        "has_unhelpful_behaviour" boolean NOT NULL DEFAULT false,
        "judge_model" character varying(120) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_qa_scores" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_helpline_qa_scores_chat" UNIQUE ("chat_id"),
        CONSTRAINT "FK_helpline_qa_scores_chat" FOREIGN KEY ("chat_id") REFERENCES "helpline_chats"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_qa_scores_listener" ON "helpline_qa_scores" ("tenant_id", "listener_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "helpline_talker_feedback" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "chat_id" uuid NOT NULL,
        "rating" smallint NOT NULL,
        "comment" character varying(1000),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_helpline_talker_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_helpline_talker_feedback_chat" UNIQUE ("chat_id"),
        CONSTRAINT "FK_helpline_talker_feedback_chat" FOREIGN KEY ("chat_id") REFERENCES "helpline_chats"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_helpline_talker_feedback_rating" CHECK ("rating" BETWEEN 1 AND 5)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Children first: every table below references helpline_chats.
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_talker_feedback"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_qa_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_chat_summaries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_chat_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_risk_flags"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "helpline_risk_keyword_rules"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "helpline_listener_profiles"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_chats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "helpline_talkers"`);
  }
}
