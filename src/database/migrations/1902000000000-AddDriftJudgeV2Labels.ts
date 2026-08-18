import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drift judge v2 labels, for the Weak Performing Metrics dashboard.
 *
 * Six per-turn labels the judge now emits: four for actor clienthood
 * (role inversion + over-compliance) and two for conversational progression.
 * Every one is a boolean or a count — the judge answers yes/no/how-many and
 * nothing else, so every rate stays computed at read time and re-weighting a
 * metric never means re-judging the corpus.
 *
 * All nullable, and null on every existing row. That is deliberate: v1 rows
 * predate the labels and must not read as `false`. The dashboard pins to one
 * (judgeModel, judgePromptVersion) pair, so v1 and v2 rows are never averaged
 * together.
 *
 * The backfill's "has this session been judged under this version yet?" lookup
 * is already served by the table's unique constraint
 * (scenarioSessionId, turnIndex, judgeModel, judgePromptVersion) — no new index
 * needed for that. What the re-judge does change is the read side: it adds a
 * second full set of rows for the same corpus, so from then on every dashboard
 * query discards roughly half the table on the pinned pair. Hence the version
 * index below.
 */
export class AddDriftJudgeV2Labels1902000000000 implements MigrationInterface {
  name = 'AddDriftJudgeV2Labels1902000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "turn_drift_judgment"
        ADD COLUMN IF NOT EXISTS "roleInversion" boolean,
        ADD COLUMN IF NOT EXISTS "offeredSolution" boolean,
        ADD COLUMN IF NOT EXISTS "solutionsOffered" integer,
        ADD COLUMN IF NOT EXISTS "introducedNewInformation" boolean,
        ADD COLUMN IF NOT EXISTS "stuckIsAppropriate" boolean,
        ADD COLUMN IF NOT EXISTS "resistanceBriefed" boolean
    `);

    // The clienthood tab slices role inversion by scenario, and role_slip is
    // heavily concentrated in a handful of scenarios — so this is the access
    // path that actually gets used. Partial: only rows carrying the label.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "turn_drift_judgment_role_inversion_idx"
        ON "turn_drift_judgment" ("scenarioId", "occurredAt")
        WHERE "roleInversion" IS TRUE
    `);

    // Every read on this table — dashboard and per-session panel alike — pins
    // (judgeModel, judgePromptVersion) and then windows on occurredAt, because
    // mixing rubric versions makes rates incomparable. Ordered to match.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "turn_drift_judgment_judge_version_idx"
        ON "turn_drift_judgment" ("judgeModel", "judgePromptVersion", "occurredAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "turn_drift_judgment_judge_version_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "turn_drift_judgment_role_inversion_idx"`,
    );
    await queryRunner.query(`
      ALTER TABLE "turn_drift_judgment"
        DROP COLUMN IF EXISTS "resistanceBriefed",
        DROP COLUMN IF EXISTS "stuckIsAppropriate",
        DROP COLUMN IF EXISTS "introducedNewInformation",
        DROP COLUMN IF EXISTS "solutionsOffered",
        DROP COLUMN IF EXISTS "offeredSolution",
        DROP COLUMN IF EXISTS "roleInversion"
    `);
  }
}
