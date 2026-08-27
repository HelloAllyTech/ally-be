import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ties an opportunity to the Builder session started from it.
 *
 * WHY A COLUMN AND NOT A LOOKUP: without it, "Open in Builder Agent" is a button that forks the
 * work every time it is pressed — close the drawer, press again, and you have two half-finished
 * interviews seeded from the same text with no way to tell which one someone is answering. The
 * column makes the second press a resume.
 *
 * ON DELETE SET NULL rather than CASCADE: a deleted Builder session must not take the
 * opportunity — the roadmap row is the durable artefact and the session is a thing that happened
 * to it. Nullable because almost every row will never have one.
 *
 * UNIQUE, so two opportunities cannot claim the same session. A session's transcript is seeded
 * from one opportunity's text and its PRD becomes that opportunity's build; sharing one would
 * make "which opportunity is this building?" unanswerable.
 */
export class AddRoadmapOpportunityBuilderSession1940400000000 implements MigrationInterface {
  name = 'AddRoadmapOpportunityBuilderSession1940400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD COLUMN "builderSessionId" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD CONSTRAINT "FK_roadmap_opps_builder_session"
        FOREIGN KEY ("builderSessionId") REFERENCES "builder_sessions"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_roadmap_opps_builder_session"
        ON "roadmap_opportunities" ("builderSessionId")
        WHERE "builderSessionId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_roadmap_opps_builder_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "FK_roadmap_opps_builder_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "builderSessionId"`,
    );
  }
}
