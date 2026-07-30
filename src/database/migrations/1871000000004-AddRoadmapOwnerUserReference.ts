import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An opportunity owner must be an Ally SUPER_ADMIN / SUPER_DUPER_ADMIN user, not a free-text name.
 *
 * WHY BOTH COLUMNS SURVIVE. `roadmap_opportunities.owner` is a text FK by NAME into
 * roadmap_opportunity_owners(name), and that was a deliberate choice: `roadmap_saved_views.state`
 * stores owner NAMES inside `ownerFilter`, so four of the eight views migrated from production are
 * defined entirely by a name string. Replacing the name with an id would break them silently — the
 * board would apply the view and quietly show everything.
 *
 * So this adds `ownerUserId` as the ASSIGNMENT and keeps `owner` as the legacy/display value:
 *
 *   ownerUserId IS NOT NULL  → a real Ally super-admin user owns this. Display name comes from
 *                              users.name via a join, so an Ally rename propagates for free —
 *                              which is the property the FK-by-name + ON UPDATE CASCADE was
 *                              there to provide in the first place.
 *   ownerUserId IS NULL      → a legacy migrated string, still shown, still filterable, until
 *                              somebody reassigns it to a real user.
 *
 * NO BACKFILL BY NAME MATCHING. It is tempting to join the four migrated names to users.name and
 * fill in the ids. Deliberately not doing it: name collision or a near-miss would attribute
 * someone's opportunities to the wrong person, and an owner is an accountability signal. Legacy
 * rows keep their text until a human picks a user. `GET opportunity-owners/eligible` plus the
 * unassigned-owner filter make that a visible, finite piece of cleanup rather than a silent guess.
 *
 * ON DELETE SET NULL, not CASCADE: deleting an Ally user must never delete roadmap history. The
 * row falls back to whatever text `owner` holds.
 */
export class AddRoadmapOwnerUserReference1871000000004 implements MigrationInterface {
  name = 'AddRoadmapOwnerUserReference1871000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD COLUMN IF NOT EXISTS "ownerUserId" integer NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD CONSTRAINT "FK_roadmap_opportunities_owner_user"
        FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
        ON UPDATE CASCADE ON DELETE SET NULL
    `);

    // Partial index, matching the existing owner index: every list query filters
    // "deletedAt" IS NULL, so indexing soft-deleted rows would only add write cost.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_roadmap_opps_owner_user"
        ON "roadmap_opportunities" ("ownerUserId")
        WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_roadmap_opps_owner_user"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        DROP CONSTRAINT IF EXISTS "FK_roadmap_opportunities_owner_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "ownerUserId"
    `);
  }
}
