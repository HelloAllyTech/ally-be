import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product Roadmap — a coin-voting prioritisation board, rebuilt inside Ally from the
 * standalone `sandeep-roadmap-app` (Next.js + Supabase). Ten tables, all global
 * (BaseWithoutTenantEntity — no tenant_id), because this is an internal product-planning
 * surface like AI Lab and the comfort-audio library rather than tenant content.
 *
 *  - roadmap_product_goals        — the 7-item goal taxonomy. FK TARGET BY NAME.
 *  - roadmap_opportunity_owners   — the owner list. FK TARGET BY NAME.
 *  - roadmap_opportunities        — the atomic unit: an idea or bug, one goal, an optional
 *                                  owner and PRD, and a 5-stage lifecycle.
 *  - roadmap_allocations          — the votes. 100 coins per user per calendar month.
 *  - roadmap_opportunity_comments — threadless comments, ≤500 chars.
 *  - roadmap_interview_notes      — qualitative research (transcript + AI summary).
 *  - roadmap_release_notes        — AI-drafted, admin-edited; keeps a DENORMALISED
 *                                  uuid[] snapshot of the opportunities it covers.
 *  - roadmap_saved_views          — named jsonb filter/sort snapshots, per user, pinnable.
 *  - roadmap_user_tab_order       — each user's ordering of their saved-view tabs.
 *  - roadmap_user_map             — Supabase uuid → Ally users.id (int) mapping, written
 *                                  by the one-off import script. See §A4 of the plan.
 *
 * Deliberate design decisions, so nobody "fixes" them later:
 *
 * 1. `productGoal` and `owner` are TEXT foreign keys BY NAME (ON UPDATE CASCADE), not uuid
 *    FKs, even though both parent tables have uuid PKs. Reason: roadmap_saved_views.state
 *    jsonb stores goal and owner NAMES in its goalFilter/ownerFilter arrays, so switching
 *    to ids would silently break every migrated saved view. ON UPDATE CASCADE is also the
 *    correct semantics — renaming is the only mutation the owner admin UI offers, and it
 *    must propagate.
 *
 * 2. CHECK constraints carry the value sets for `type` and `stage` instead of Postgres
 *    enums (ally-be convention is TS enum + character varying). The CHECKs recover the
 *    guarantee the pg enums gave us: without them a typo'd stage in a backfill script
 *    would create an opportunity that renders as blank. Same for every length limit —
 *    class-validator gives a friendly 400, the CHECK makes a bad row impossible even from
 *    psql or an import script.
 *
 * 3. `roadmap_allocations` has NO deletedAt. Setting coins to 0 deletes the row (that is
 *    what the source did, and a soft-deleted allocation would still have to be excluded
 *    from every SUM, which is a footgun on the one number that matters). Its uniqueness is
 *    therefore a real UNIQUE constraint, not a partial index.
 *
 * 4. roadmap_product_goals and roadmap_opportunity_owners have NO deletedAt either: they
 *    are FK targets, so a soft-deleted parent would still satisfy the FK and the board
 *    would show a goal that admins believe they removed.
 *
 * 5. There is deliberately NO `embedding` column and no pgvector. Semantic
 *    duplicate-detection lives in ally-ai's Weaviate (`RoadmapOpportunity` collection,
 *    OpenAI text-embedding-3-small); ally-be's Postgres stays the system of record and
 *    treats the vector index as derived. The embeddingStatus/embeddingAttempts/embeddedAt/
 *    textHash columns are the reconciliation state for that derived index — Weaviate has
 *    no idea an opportunity was soft-deleted, so drift has to be detectable and healable.
 *
 * 6. The monthly coin cap is a cross-row invariant no CHECK can express; it ships as a
 *    trigger in the next migration (1871000000001) plus a service-level advisory lock.
 */
export class CreateProductRoadmapTables1871000000000 implements MigrationInterface {
  name = 'CreateProductRoadmapTables1871000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── FK targets first ────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "roadmap_product_goals" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" text NOT NULL, "position" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_roadmap_product_goals_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_roadmap_product_goals_name" UNIQUE ("name"), CONSTRAINT "CHK_roadmap_product_goals_name" CHECK (char_length(trim("name")) > 0 AND char_length("name") <= 200))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_product_goals_position" ON "roadmap_product_goals" ("position")`,
    );

    await queryRunner.query(
      `CREATE TABLE "roadmap_opportunity_owners" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" text NOT NULL, "position" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_roadmap_opportunity_owners_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_roadmap_opportunity_owners_name" UNIQUE ("name"), CONSTRAINT "CHK_roadmap_opp_owners_name" CHECK (char_length(trim("name")) > 0 AND char_length("name") <= 200))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opp_owners_position" ON "roadmap_opportunity_owners" ("position")`,
    );

    // ── opportunities ───────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "roadmap_opportunities" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "description" text NOT NULL, "type" character varying NOT NULL DEFAULT 'idea', "stage" character varying NOT NULL DEFAULT 'new', "productGoal" text NOT NULL, "owner" text, "prd" text, "releasedAt" TIMESTAMP, "embeddingStatus" character varying NOT NULL DEFAULT 'pending', "embeddingAttempts" integer NOT NULL DEFAULT 0, "embeddedAt" TIMESTAMP, "textHash" text, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roadmap_opportunities_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_roadmap_opps_description" CHECK (char_length(trim("description")) > 0 AND char_length("description") <= 1000), CONSTRAINT "CHK_roadmap_opps_prd" CHECK ("prd" IS NULL OR char_length("prd") <= 20000), CONSTRAINT "CHK_roadmap_opps_type" CHECK ("type" IN ('idea', 'bug')), CONSTRAINT "CHK_roadmap_opps_stage" CHECK ("stage" IN ('new', 'prioritised', 'under_development', 'released', 'archived')), CONSTRAINT "CHK_roadmap_opps_embedding_status" CHECK ("embeddingStatus" IN ('pending', 'success', 'failed', 'skipped')))`,
    );
    // FK BY NAME with ON UPDATE CASCADE — see the header, decision 1.
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "FK_roadmap_opps_product_goal" FOREIGN KEY ("productGoal") REFERENCES "roadmap_product_goals" ("name") ON UPDATE CASCADE ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "FK_roadmap_opps_owner" FOREIGN KEY ("owner") REFERENCES "roadmap_opportunity_owners" ("name") ON UPDATE CASCADE ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_stage" ON "roadmap_opportunities" ("stage") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_created_at" ON "roadmap_opportunities" ("createdAt" DESC) WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_product_goal" ON "roadmap_opportunities" ("productGoal") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_owner" ON "roadmap_opportunities" ("owner") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_created_by" ON "roadmap_opportunities" ("createdBy") WHERE "deletedAt" IS NULL`,
    );
    // Drives the Weaviate reconciliation sweep and the one-time backfill.
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_embedding_status" ON "roadmap_opportunities" ("embeddingStatus") WHERE "deletedAt" IS NULL AND "embeddingStatus" <> 'success'`,
    );

    // ── allocations (the votes) ─────────────────────────────────────────────────
    // periodKey uses [0-9] rather than \d on purpose: inside a JS template literal a
    // backslash-d collapses to a bare "d" and the regex would silently match nothing.
    await queryRunner.query(
      `CREATE TABLE "roadmap_allocations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "opportunityId" uuid NOT NULL, "periodKey" character varying(7) NOT NULL, "coins" integer NOT NULL, CONSTRAINT "PK_roadmap_allocations_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_roadmap_allocations_user_opp_period" UNIQUE ("userId", "opportunityId", "periodKey"), CONSTRAINT "CHK_roadmap_allocations_coins" CHECK ("coins" >= 0 AND "coins" <= 100), CONSTRAINT "CHK_roadmap_allocations_period" CHECK ("periodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_allocations" ADD CONSTRAINT "FK_roadmap_allocations_opportunity" FOREIGN KEY ("opportunityId") REFERENCES "roadmap_opportunities" ("id") ON DELETE CASCADE`,
    );
    // The priority-score aggregate's index: SUM(coins) GROUP BY "opportunityId".
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_allocations_opportunity" ON "roadmap_allocations" ("opportunityId")`,
    );
    // The monthly-cap lookup: SUM(coins) WHERE "userId" = $1 AND "periodKey" = $2.
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_allocations_user_period" ON "roadmap_allocations" ("userId", "periodKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_allocations_period" ON "roadmap_allocations" ("periodKey")`,
    );

    // ── comments ───────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "roadmap_opportunity_comments" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "opportunityId" uuid NOT NULL, "body" text NOT NULL, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roadmap_opp_comments_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_roadmap_opp_comments_body" CHECK (char_length(trim("body")) > 0 AND char_length("body") <= 500))`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunity_comments" ADD CONSTRAINT "FK_roadmap_opp_comments_opportunity" FOREIGN KEY ("opportunityId") REFERENCES "roadmap_opportunities" ("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opp_comments_opp_created" ON "roadmap_opportunity_comments" ("opportunityId", "createdAt") WHERE "deletedAt" IS NULL`,
    );

    // ── interview notes ────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "roadmap_interview_notes" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" text NOT NULL, "interviewee" text, "transcript" text, "summary" text NOT NULL, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roadmap_interview_notes_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_roadmap_interview_notes_title" CHECK (char_length(trim("title")) > 0 AND char_length("title") <= 200), CONSTRAINT "CHK_roadmap_interview_notes_summary" CHECK (char_length(trim("summary")) > 0 AND char_length("summary") <= 5000))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_interview_notes_created_at" ON "roadmap_interview_notes" ("createdAt" DESC) WHERE "deletedAt" IS NULL`,
    );

    // ── release notes ──────────────────────────────────────────────────────────
    // opportunityIds stays a denormalised uuid[] snapshot, exactly as the source had it:
    // a release note records what it was generated from at that moment, and must keep
    // rendering even after the taxonomy moves on.
    await queryRunner.query(
      `CREATE TABLE "roadmap_release_notes" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" text, "content" text NOT NULL, "opportunityIds" uuid array NOT NULL DEFAULT '{}', "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roadmap_release_notes_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_roadmap_release_notes_content" CHECK (char_length(trim("content")) > 0 AND char_length("content") <= 20000), CONSTRAINT "CHK_roadmap_release_notes_title" CHECK ("title" IS NULL OR char_length("title") <= 200))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_release_notes_created_at" ON "roadmap_release_notes" ("createdAt" DESC) WHERE "deletedAt" IS NULL`,
    );

    // ── saved views + per-user tab order ───────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "roadmap_saved_views" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" text NOT NULL, "state" jsonb NOT NULL DEFAULT '{}'::jsonb, "pinned" boolean NOT NULL DEFAULT false, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roadmap_saved_views_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_roadmap_saved_views_name" CHECK (char_length(trim("name")) > 0 AND char_length("name") <= 100))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_saved_views_created_by" ON "roadmap_saved_views" ("createdBy") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_saved_views_pinned" ON "roadmap_saved_views" ("pinned") WHERE "pinned" = true AND "deletedAt" IS NULL`,
    );

    // Surrogate uuid id + UNIQUE userId (rather than userId as the PK) so the entity
    // matches ally-be's @PrimaryGeneratedColumn('uuid') convention.
    await queryRunner.query(
      `CREATE TABLE "roadmap_user_tab_order" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "viewIds" uuid array NOT NULL DEFAULT '{}', CONSTRAINT "PK_roadmap_user_tab_order_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_roadmap_user_tab_order_user" UNIQUE ("userId"))`,
    );

    // ── migration bookkeeping ──────────────────────────────────────────────────
    // A real table, not a temp one: a re-run or a delta extract must reproduce identical
    // ids, and this doubles as the permanent decision log for which Ally users the
    // import created. The UNIQUE on sourceEmailLower is load-bearing — it turns an
    // email case-collision into a loud constraint violation inside the import
    // transaction instead of a silent merge of two voters' allocation rows.
    await queryRunner.query(
      `CREATE TABLE "roadmap_user_map" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "sourceUserId" uuid NOT NULL, "sourceEmail" character varying NOT NULL, "sourceEmailLower" character varying NOT NULL, "sourceRole" character varying NOT NULL, "allyUserId" integer NOT NULL, "createdByMigration" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_roadmap_user_map_source_user_id" PRIMARY KEY ("sourceUserId"), CONSTRAINT "UQ_roadmap_user_map_email_lower" UNIQUE ("sourceEmailLower"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_user_map_ally_user" ON "roadmap_user_map" ("allyUserId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse FK order. Safe to drop wholesale: nothing outside the roadmap feature
    // references these tables.
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_user_map"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_user_tab_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_saved_views"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_release_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_interview_notes"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "roadmap_opportunity_comments"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_allocations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_opportunities"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "roadmap_opportunity_owners"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_product_goals"`);
  }
}
