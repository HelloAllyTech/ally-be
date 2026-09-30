import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The two tables behind feature-level product updates.
 *
 * `product_update_sources` holds one row per merge read from
 * `ally-changelog`'s journal (keyed on the journal's own id, so re-reading it
 * is idempotent). `product_updates` holds what those merges add up to: one row
 * per change a person would recognise, which is what the public changelog and
 * the team digest are built from.
 *
 * Platform-wide, not tenant-scoped. Hand-written, like every recent CREATE
 * here — never `migration:generate`.
 *
 * Nothing is backfilled by this migration. The journal is replayed by the
 * product-updates pipeline itself (an admin-triggered backfill), because
 * turning merges into updates needs GitHub and a model, neither of which a
 * migration should call.
 */
export class CreateProductUpdates1974900000000 implements MigrationInterface {
  name = 'CreateProductUpdates1974900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_updates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying(120) NOT NULL,
        "title" character varying(160) NOT NULL,
        "summary" text NOT NULL,
        "team_notes" text NOT NULL DEFAULT '',
        "kind" character varying(16) NOT NULL,
        "audience" character varying(16) NOT NULL,
        "surfaces" text[] NOT NULL DEFAULT '{}',
        "area" character varying(40) NOT NULL,
        "confidence" numeric(3,2) NOT NULL DEFAULT 0.5,
        "hidden" boolean NOT NULL DEFAULT false,
        "edited_fields" text[] NOT NULL DEFAULT '{}',
        "edited_by" integer,
        "edited_at" TIMESTAMP,
        "first_merged_at" TIMESTAMP NOT NULL,
        "last_merged_at" TIMESTAMP NOT NULL,
        "live_at" TIMESTAMP,
        "published_at" TIMESTAMP,
        "announced_at" TIMESTAMP,
        "announced_live" boolean NOT NULL DEFAULT false,
        "model" character varying(120),
        "decision_reason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_product_updates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_product_updates_kind"
          CHECK ("kind" IN ('new', 'improved', 'fixed')),
        CONSTRAINT "CHK_product_updates_audience"
          CHECK ("audience" IN ('public', 'internal')),
        CONSTRAINT "CHK_product_updates_confidence"
          CHECK ("confidence" >= 0 AND "confidence" <= 1)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_product_updates_slug" ON "product_updates" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_updates_live_at" ON "product_updates" ("live_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "product_update_sources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "journal_id" character varying(64) NOT NULL,
        "update_id" uuid,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "repo" character varying(64) NOT NULL,
        "apps" text[] NOT NULL DEFAULT '{}',
        "merged_at" TIMESTAMP NOT NULL,
        "journal_label" character varying(24) NOT NULL,
        "pr_number" integer,
        "pr_url" text,
        "head_ref" character varying(255),
        "head_sha" character varying(40),
        "base_sha" character varying(48),
        "author" character varying(120),
        "subjects" text[] NOT NULL DEFAULT '{}',
        "body" text,
        "files" text[] NOT NULL DEFAULT '{}',
        "files_truncated" boolean NOT NULL DEFAULT false,
        "deployables" text[] NOT NULL DEFAULT '{}',
        "gates_liveness" boolean NOT NULL DEFAULT true,
        "live_at" TIMESTAMP,
        "enrich_attempts" integer NOT NULL DEFAULT 0,
        "consolidate_attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "enriched_at" TIMESTAMP,
        "consolidated_at" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_update_sources" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_update_sources_update"
          FOREIGN KEY ("update_id") REFERENCES "product_updates"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_product_update_sources_status"
          CHECK ("status" IN ('pending', 'enriched', 'consolidated', 'noise')),
        CONSTRAINT "CHK_product_update_sources_journal_label"
          CHECK ("journal_label" IN ('public', 'internal', 'needs_release_note'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_product_update_sources_journal_id" ON "product_update_sources" ("journal_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_update_sources_status" ON "product_update_sources" ("status", "merged_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_update_sources_update_id" ON "product_update_sources" ("update_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_update_sources"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_updates"`);
  }
}
