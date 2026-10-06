import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repeated risk hits fold into the chat's open flag until it is acknowledged
 * (docs/text-helpline.md §9.3): one banner per chat instead of one per message.
 *
 * - `hit_count` — messages that hit while this flag was open (1 = the opener).
 * - `last_hit_at` — when the latest of them arrived.
 * - `latest_message_id`, `latest_signal_start`, `latest_signal_end` — where the
 *   latest hit is, as OFFSETS into that message (never the text, invariant 5),
 *   so the listener's banner can show the newest signal and it disappears with
 *   the body.
 *
 * Existing rows are backfilled as single-hit flags (their own message is the
 * latest). Nothing is merged: a chat that already has several open flags keeps
 * them, and new hits fold into the newest.
 */
export class FoldHelplineRiskFlagHits1975820000000 implements MigrationInterface {
  name = 'FoldHelplineRiskFlagHits1975820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags"
         ADD COLUMN IF NOT EXISTS "hit_count" integer NOT NULL DEFAULT 1,
         ADD COLUMN IF NOT EXISTS "last_hit_at" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN IF NOT EXISTS "latest_message_id" integer,
         ADD COLUMN IF NOT EXISTS "latest_signal_start" integer,
         ADD COLUMN IF NOT EXISTS "latest_signal_end" integer`,
    );
    await queryRunner.query(
      `UPDATE "helpline_risk_flags"
          SET "last_hit_at" = COALESCE("last_hit_at", "created_at"),
              "latest_message_id" = COALESCE("latest_message_id", "message_id"),
              "latest_signal_start" = COALESCE("latest_signal_start", "signal_start"),
              "latest_signal_end" = COALESCE("latest_signal_end", "signal_end")`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags"
         ADD CONSTRAINT "CHK_helpline_risk_flags_hit_count" CHECK ("hit_count" >= 1),
         ADD CONSTRAINT "CHK_helpline_risk_flags_latest_offsets" CHECK (
           "latest_signal_start" IS NULL
           OR ("latest_signal_start" >= 0 AND "latest_signal_end" >= "latest_signal_start"))`,
    );
    // The fold looks up the chat's open (unacknowledged) flag on every hit.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_helpline_risk_flags_open"
         ON "helpline_risk_flags" ("tenant_id", "chat_id") WHERE "acknowledged_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_helpline_risk_flags_open"`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags"
         DROP CONSTRAINT IF EXISTS "CHK_helpline_risk_flags_latest_offsets",
         DROP CONSTRAINT IF EXISTS "CHK_helpline_risk_flags_hit_count",
         DROP COLUMN IF EXISTS "latest_signal_end",
         DROP COLUMN IF EXISTS "latest_signal_start",
         DROP COLUMN IF EXISTS "latest_message_id",
         DROP COLUMN IF EXISTS "last_hit_at",
         DROP COLUMN IF EXISTS "hit_count"`,
    );
  }
}
