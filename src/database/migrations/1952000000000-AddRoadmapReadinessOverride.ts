import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records that an opportunity was filed against a failing readiness verdict, by whom, and
 * which items were red at the time.
 *
 * WHY: until now the readiness checklist was enforced entirely in the admin drawer's `canSave`.
 * `POST /opportunities` validated a description length and a product goal and saved — so the
 * gate was a discipline the client chose to keep, and a vote-tier token plus curl filed anything
 * at any size. The gate has moved server-side (see RoadmapReadinessTokenService), and a gate
 * with a sanctioned escape hatch needs the escape hatch to leave a trace: an override nobody can
 * see afterwards is indistinguishable from the gate not working.
 *
 * ## Three nullable columns, no backfill, no default
 *
 * Every existing row is NULL, meaning "nothing to explain" — either it was graded green or it
 * predates the gate. Those two are not distinguishable for rows already on the board and no
 * backfill can honestly invent the difference, so the column answers the question that IS
 * answerable: was this row waved through by a named person, or not.
 *
 * `readiness_failed_criteria` is jsonb rather than text[] to match the reference-images
 * precedent on this table (migration 1944400000000) — one array convention per table beats a
 * marginally tighter type. It holds criterion ids, plus the literal `size` for the size row,
 * which is derived rather than graded and therefore has no id in ROADMAP_READINESS_CRITERIA.
 *
 * ## The CHECK, and what it does not try to say
 *
 * `by` and `at` are set together or not at all, and the CHECK says so — a half-written override
 * is a bug, and a constraint is how it stops being possible from psql too. The failed-criteria
 * array is deliberately NOT part of that: an override recorded against an empty list is
 * meaningless but harmless, and constraining a jsonb array's shape in SQL buys less than it
 * costs to read.
 *
 * ## The partial index
 *
 * Overridden rows are the interesting minority and the reason to query this at all ("show me
 * what got waved through"). A partial index over the non-NULL rows stays tiny however large the
 * table gets, where a full index would be mostly NULLs. Matches the `WHERE "deletedAt" IS NULL`
 * shape every other index on this table uses.
 */
export class AddRoadmapReadinessOverride1952000000000 implements MigrationInterface {
  name = 'AddRoadmapReadinessOverride1952000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "readinessOverriddenBy" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "readinessOverriddenAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "readinessFailedCriteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT ` +
        `"CHK_roadmap_opportunities_readiness_override" CHECK (` +
        `("readinessOverriddenBy" IS NULL AND "readinessOverriddenAt" IS NULL) OR ` +
        `("readinessOverriddenBy" IS NOT NULL AND "readinessOverriddenAt" IS NOT NULL))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_readiness_overridden" ON "roadmap_opportunities" ` +
        `("readinessOverriddenAt") WHERE "readinessOverriddenBy" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_roadmap_opps_readiness_overridden"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT ` +
        `"CHK_roadmap_opportunities_readiness_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "readinessFailedCriteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "readinessOverriddenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "readinessOverriddenBy"`,
    );
  }
}
