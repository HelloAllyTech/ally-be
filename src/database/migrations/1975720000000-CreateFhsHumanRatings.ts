import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foundational helping skills — HUMAN ratings, the check on the judge (EFF-81).
 *
 *  - `fhs_human_ratings` — one person's rating of one cut under one rubric
 *    version: behaviour codes ticked per skill in the judge's own `verdicts`
 *    shape, levels derived in code exactly as the judge's are, and the
 *    any-unhelpful flag. `(cutId, raterId, rubricVersion)` is unique, so a
 *    rater re-submitting replaces their own row and a rubric bump starts a
 *    fresh set. `cutId` cascades from `foundational_skill_cuts`, like
 *    `foundational_skill_assessments`; `raterId` (users.id) has no FK, like the
 *    cuts' `userId`. No quotes and no free text are stored.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateFhsHumanRatings1975720000000 implements MigrationInterface {
  name = 'CreateFhsHumanRatings1975720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fhs_human_ratings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cutId" uuid NOT NULL,
        "raterId" integer NOT NULL,
        "rubricVersion" character varying(64) NOT NULL,
        "ticks" jsonb NOT NULL DEFAULT '[]',
        "anyUnhelpful" boolean NOT NULL,
        "ratedAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fhs_human_ratings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fhs_human_ratings_ticks_array" CHECK (jsonb_typeof("ticks") = 'array'),
        CONSTRAINT "FK_fhs_human_ratings_cut" FOREIGN KEY ("cutId")
          REFERENCES "foundational_skill_cuts"("id") ON DELETE CASCADE
      )
    `);
    // The upsert's conflict target, and the per-cut rater count the sample reads.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fhs_human_ratings_cut_rater_version" ON "fhs_human_ratings" ("cutId", "raterId", "rubricVersion")`,
    );
    // The agreement read: every rating under one version.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fhs_human_ratings_version" ON "fhs_human_ratings" ("rubricVersion")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "fhs_human_ratings"`);
  }
}
