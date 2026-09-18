import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Composite ranking: three tables that turn "most votes" into a four-factor score.
 *
 *  - roadmap_strategy_goals             — the strategy the board is ranked against. FK TARGET
 *                                         BY NAME, like roadmap_product_goals.
 *  - roadmap_opportunity_goal_impacts   — one row per (opportunity, strategy goal): did this
 *                                         opportunity positively move that goal, per the LLM.
 *  - roadmap_rank_weights               — a SINGLETON row holding the four factor weights.
 *
 * ## Why strategy goals are a NEW table rather than a reuse of roadmap_product_goals
 *
 * `roadmap_opportunities.productGoal` is a CATEGORY — exactly one per opportunity, used to file
 * and filter. Strategy goals are a different axis: an opportunity may advance several at once,
 * or none, and that is the thing worth ranking on. Overloading the existing table would have
 * forced the category to become many-to-many and broken every saved view whose goalFilter
 * stores category names. The two are deliberately independent and may be worded quite
 * differently — a category is "Scribe", a strategy goal is "Cut time-to-first-value".
 *
 * ## Why per-goal verdict ROWS rather than a stored percentage
 *
 * Coverage is `helped / total goals`, so a single stored percentage is only meaningful against
 * the goal list it was computed from. Storing the individual verdicts instead means the
 * denominator is always read live and the arithmetic can never reference a goal list that no
 * longer exists:
 *
 *   - DELETE a goal → its impact rows cascade away and coverage recomputes. Zero LLM calls.
 *   - RENAME a goal → ON UPDATE CASCADE carries the rows across. Zero LLM calls.
 *   - ADD a goal    → genuinely unknown for every existing opportunity. This is the ONLY case
 *                     that needs the model, and it is why `assessedAt` exists: an opportunity
 *                     with fewer impact rows than there are goals is detectably stale, so the
 *                     settings UI can offer "N not yet assessed" and a bulk re-run rather than
 *                     quietly dividing by the wrong number.
 *
 * A denormalised coverage column was rejected for the same reason the vote counter was (see the
 * note on RoadmapOpportunity): the code path most likely to get it wrong is split/merge, and a
 * wrong counter cannot be recovered without a rebuild job you would have to write anyway.
 *
 * ## Why the weights are a singleton TABLE and not a Preference
 *
 * The per-tenant Preference recipe does not apply: the roadmap is a global internal surface with
 * no tenant, and these four numbers are read by the LIST QUERY on every board load. A row this
 * query can join is cheaper and more honest than a key-value lookup, and the CHECK constraints
 * below make a nonsensical weight set impossible even from psql.
 *
 * Weights are stored as plain non-negative integers and normalised to sum 1 at read time, so an
 * admin can type 3/1/1/2 without doing arithmetic, and a row of all-zeros is rejected rather
 * than producing a divide-by-zero in the ranking SQL.
 */
export class CreateRoadmapStrategyGoals1944100000000 implements MigrationInterface {
  name = 'CreateRoadmapStrategyGoals1944100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── strategy goals ───────────────────────────────────────────────────────
    // NO deletedAt, for the same reason roadmap_product_goals has none: this is an FK target,
    // so a soft-deleted row would still satisfy the FK and the board would keep ranking against
    // a goal admins believe they removed.
    await queryRunner.query(
      `CREATE TABLE "roadmap_strategy_goals" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"name" text NOT NULL, ` +
        `"position" integer NOT NULL DEFAULT 0, ` +
        `CONSTRAINT "PK_roadmap_strategy_goals_id" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "UQ_roadmap_strategy_goals_name" UNIQUE ("name"), ` +
        `CONSTRAINT "CHK_roadmap_strategy_goals_name" ` +
        `CHECK (char_length(trim("name")) > 0 AND char_length("name") <= 200))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_strategy_goals_position" ON "roadmap_strategy_goals" ("position")`,
    );

    // ── per-goal impact verdicts ─────────────────────────────────────────────
    // `goalName` is a text FK BY NAME with ON UPDATE CASCADE — matching productGoal's treatment
    // — so renaming a strategy goal carries every verdict with it. ON DELETE CASCADE (rather
    // than RESTRICT, which guards the category table) because a verdict has no meaning without
    // its goal: there is nothing to reassign it to, and blocking the delete would strand an
    // admin with no way to retire a goal they had already ranked against.
    await queryRunner.query(
      `CREATE TABLE "roadmap_opportunity_goal_impacts" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"opportunityId" uuid NOT NULL, ` +
        `"goalName" text NOT NULL, ` +
        `"helped" boolean NOT NULL, ` +
        `"reason" text, ` +
        `"assessedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_roadmap_opp_goal_impacts_id" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "UQ_roadmap_opp_goal_impacts_opp_goal" UNIQUE ("opportunityId", "goalName"), ` +
        `CONSTRAINT "CHK_roadmap_opp_goal_impacts_reason" ` +
        `CHECK ("reason" IS NULL OR char_length("reason") <= 500))`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunity_goal_impacts" ` +
        `ADD CONSTRAINT "FK_roadmap_opp_goal_impacts_opportunity" ` +
        `FOREIGN KEY ("opportunityId") REFERENCES "roadmap_opportunities"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunity_goal_impacts" ` +
        `ADD CONSTRAINT "FK_roadmap_opp_goal_impacts_goal" ` +
        `FOREIGN KEY ("goalName") REFERENCES "roadmap_strategy_goals"("name") ` +
        `ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    // The coverage aggregate: COUNT(*) FILTER (WHERE helped) GROUP BY "opportunityId".
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opp_goal_impacts_opportunity" ` +
        `ON "roadmap_opportunity_goal_impacts" ("opportunityId")`,
    );

    // ── rank weights (singleton) ─────────────────────────────────────────────
    // `id` is a CHECK-pinned constant rather than a uuid: there is exactly one weight set, and
    // a second row would silently make the ranking depend on which one the query happened to
    // read first. This makes "there is one row" a database guarantee instead of a convention.
    await queryRunner.query(
      `CREATE TABLE "roadmap_rank_weights" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" integer NOT NULL DEFAULT 1, ` +
        `"votesWeight" integer NOT NULL DEFAULT 3, ` +
        `"votersWeight" integer NOT NULL DEFAULT 3, ` +
        `"effortWeight" integer NOT NULL DEFAULT 1, ` +
        `"goalImpactWeight" integer NOT NULL DEFAULT 3, ` +
        `CONSTRAINT "PK_roadmap_rank_weights_id" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "CHK_roadmap_rank_weights_singleton" CHECK ("id" = 1), ` +
        `CONSTRAINT "CHK_roadmap_rank_weights_range" CHECK (` +
        `"votesWeight" BETWEEN 0 AND 10 AND "votersWeight" BETWEEN 0 AND 10 AND ` +
        `"effortWeight" BETWEEN 0 AND 10 AND "goalImpactWeight" BETWEEN 0 AND 10), ` +
        // All-zero weights would divide by zero when normalising. Rejected at the database.
        `CONSTRAINT "CHK_roadmap_rank_weights_nonzero" CHECK (` +
        `"votesWeight" + "votersWeight" + "effortWeight" + "goalImpactWeight" > 0))`,
    );
    // The one row. Defaults deliberately start effort LOW relative to the other three: effort is
    // an inverse factor, so weighting it heavily surfaces trivial work over hard high-conviction
    // work (the classic quick-wins bias). It breaks ties by default; admins can raise it.
    await queryRunner.query(
      `INSERT INTO "roadmap_rank_weights" ("id") VALUES (1)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "roadmap_rank_weights"`);
    await queryRunner.query(`DROP TABLE "roadmap_opportunity_goal_impacts"`);
    await queryRunner.query(`DROP TABLE "roadmap_strategy_goals"`);
  }
}
