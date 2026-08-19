import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a `roadmap_opportunity_owners` row for `'Bug Hunter Agent'`.
 *
 * `roadmap_opportunities.owner` is a text FK BY NAME to this table
 * (`FK_roadmap_opps_owner`, see 1871000000000-CreateProductRoadmapTables), so
 * `BugFixSessionService`'s auto-release-on-merge write (owner set to this
 * exact string once a linked finding merges — see `releaseLinkedRoadmapOpportunity`)
 * would otherwise fail the FK the first time it runs. Idempotent, same pattern
 * as 1871000000002-SeedProductRoadmapTaxonomy; position is computed rather than
 * hardcoded so it always sorts after whatever owners already exist.
 */
const BUG_HUNTER_AGENT_OWNER = 'Bug Hunter Agent';

export class SeedBugHunterAgentRoadmapOwner1913000000000 implements MigrationInterface {
  name = 'SeedBugHunterAgentRoadmapOwner1913000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "roadmap_opportunity_owners" ("name", "position")
       VALUES ($1, (SELECT COALESCE(MAX("position"), -1) + 1 FROM "roadmap_opportunity_owners"))
       ON CONFLICT ("name") DO NOTHING`,
      [BUG_HUNTER_AGENT_OWNER],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "roadmap_opportunity_owners" WHERE "name" = $1`,
      [BUG_HUNTER_AGENT_OWNER],
    );
  }
}
