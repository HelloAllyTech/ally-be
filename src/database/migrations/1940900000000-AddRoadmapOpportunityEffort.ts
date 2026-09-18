import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every opportunity an optional effort size: S / M / L / XL / XXL.
 *
 * WHY: the board ranks by votes, which says what people WANT but nothing about what it costs.
 * "Most wanted" and "worth doing next" are different questions, and the second one needs a size
 * next to the demand. Shirt sizes rather than hours or points on purpose — the roadmap decides
 * what is next, which needs "a week or a quarter", not false precision on something nobody has
 * broken down yet.
 *
 * ## Nullable, with no default and no backfill
 *
 * Every existing row is unsized and no backfill can honestly invent a size for it. A DEFAULT of
 * 's' would silently assert that 432 rows are the smallest thing the team does. So NULL means
 * "not estimated", it is a permanent legal state rather than a gap to be filled, and nothing
 * gates on the column.
 *
 * ## varchar + CHECK, not a Postgres enum
 *
 * ally-be convention (see migration 1871000000000 and the note on RoadmapOpportunityType): the
 * TS enum is the source of truth and a CHECK recovers the guarantee that a typo cannot land in
 * the column. class-validator gives a friendly 400 on the way in; the CHECK makes a bad row
 * impossible even from psql.
 *
 * The CHECK admits NULL explicitly. A bare `IN (...)` would be UNKNOWN rather than TRUE for
 * NULL — which Postgres does not treat as a violation, so it would happen to work — but stating
 * it means the intent survives someone later tightening the constraint.
 *
 * No index. Effort is read as part of a row people are already looking at; nothing filters or
 * sorts by it today, and an index on a five-value nullable column would not help if they did.
 */
export class AddRoadmapOpportunityEffort1940900000000 implements MigrationInterface {
  name = 'AddRoadmapOpportunityEffort1940900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "effort" character varying(3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opportunities_effort" ` +
        `CHECK ("effort" IS NULL OR "effort" IN ('s', 'm', 'l', 'xl', 'xxl'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT "CHK_roadmap_opportunities_effort"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "effort"`,
    );
  }
}
