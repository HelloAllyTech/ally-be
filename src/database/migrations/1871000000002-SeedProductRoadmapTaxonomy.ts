import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the Product Roadmap taxonomy: the metric-based product goals and the owner list.
 *
 * These values are taken from the LIVE standalone app (Supabase project rmkeahsssiaqnzlahwly,
 * read 2026-07-29), not from its committed schema.sql. The two had drifted: schema.sql seeds
 * 6 goals and 3 owners, while production runs 7 goals ("Scribe" was added after the
 * 2026-06-25 six-goal remap) and 4 owners ("Ajey Gore" added). Seeding the stale set would
 * make the one-off import fail its FK-by-name checks on ~19 opportunities.
 *
 * Both tables are FK targets by NAME, so these rows must exist before any opportunity is
 * inserted. Idempotent (ON CONFLICT on the UNIQUE name) so it is safe in every environment,
 * including one that has already taken the Supabase import.
 */
const PRODUCT_GOALS = [
  'Roleplay Actor Realism',
  'Coaching Effectiveness',
  'Roleplay Actor Build Time',
  'Engagement & Usability',
  'Reliability & Trust',
  'Foundation & Experiments',
  'Scribe',
];

const OPPORTUNITY_OWNERS = [
  'Shubham Bhoite',
  'Gopikrishnan Sasikumar',
  'Sandeep Malhotra',
  'Ajey Gore',
];

export class SeedProductRoadmapTaxonomy1871000000002 implements MigrationInterface {
  name = 'SeedProductRoadmapTaxonomy1871000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [position, name] of PRODUCT_GOALS.entries()) {
      await queryRunner.query(
        `INSERT INTO "roadmap_product_goals" ("name", "position") VALUES ($1, $2)
         ON CONFLICT ("name") DO NOTHING`,
        [name, position],
      );
    }

    for (const [position, name] of OPPORTUNITY_OWNERS.entries()) {
      await queryRunner.query(
        `INSERT INTO "roadmap_opportunity_owners" ("name", "position") VALUES ($1, $2)
         ON CONFLICT ("name") DO NOTHING`,
        [name, position],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deleting a goal still referenced by an opportunity is blocked by the FK
    // (ON DELETE RESTRICT) — deliberately, so a down-migration can never silently
    // orphan the board. Drop the opportunities first if that is really intended.
    await queryRunner.query(
      `DELETE FROM "roadmap_opportunity_owners" WHERE "name" = ANY($1)`,
      [OPPORTUNITY_OWNERS],
    );
    await queryRunner.query(
      `DELETE FROM "roadmap_product_goals" WHERE "name" = ANY($1)`,
      [PRODUCT_GOALS],
    );
  }
}
