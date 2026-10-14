import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an opportunity carry the opportunity copilot's brief — strategic fit, reach, evidence
 * with sources, success metric, leap-of-faith assumptions, what was dropped, and the copilot's
 * assessment — alongside the votable description.
 *
 * ## jsonb object, nullable
 *
 * NULL means "filed without a brief": every opportunity that predates the copilot, bug
 * reports, split/merge results and the importer. There is no empty-brief value to default to —
 * `{}` would read as a brief the copilot wrote with nothing in it, which is a different claim.
 * Nothing filters or aggregates into it; it is read as part of a row someone is looking at.
 *
 * ## The CHECK bounds the shape, not the content
 *
 * It must be an object and stay under 32 KB. The per-field caps (ROADMAP_BRIEF_LIMITS) are
 * applied by normaliseOpportunityBrief on every write, and the brief is signed into the
 * readiness token, so the content is whatever the copilot wrote. The size bound is what stops
 * a jsonb column from becoming an unbounded one if a future write path forgets the normaliser:
 * at the caps a brief is ~12 KB, so 32 KB is headroom rather than a squeeze.
 */
export class AddRoadmapOpportunityBrief1977500000000 implements MigrationInterface {
  name = 'AddRoadmapOpportunityBrief1977500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "brief" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opportunities_brief" ` +
        `CHECK ("brief" IS NULL OR (jsonb_typeof("brief") = 'object' AND octet_length("brief"::text) <= 32768))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_brief"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "brief"`,
    );
  }
}
