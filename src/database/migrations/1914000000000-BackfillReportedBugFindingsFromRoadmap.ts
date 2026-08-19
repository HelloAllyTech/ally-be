import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data-only backfill — no DDL.
 *
 * `RoadmapOpportunityService.create` writes a `bug_findings` row
 * (source='reported_bug', status='new') the moment a new type='bug' roadmap
 * opportunity is filed, so the Bug Hunter tracker is a complete inbox for
 * anything filed through that path going forward. Rows that predate that
 * wiring, or that arrived some other way (e.g. migrated from the standalone
 * roadmap app), never got a matching `bug_findings` row — so a `bug`-type
 * opportunity sitting in `new` or `prioritised` can be invisible to the Bug
 * Tracker table even though it is exactly the backlog that table exists to
 * surface.
 *
 * This backfills those gaps: one `bug_findings` row per `roadmap_opportunities`
 * row with type='bug', stage IN ('new', 'prioritised'), not soft-deleted,
 * that has no existing `bug_findings` row pointing at it via
 * `reported_bug_id`. `under_development`/`released`/`archived` bugs are left
 * alone — those have already moved past the "queue this in Bug Hunter" moment
 * this backfill is for, same as the live create() path never fires for them.
 *
 * Inserted rows are tagged in `metadata` so `down` removes exactly the rows
 * this migration added and nothing a human or the pipeline created since —
 * same reasoning as `BackfillPlatformAdminGrantDates1901000000000`, just via
 * a tag instead of a timestamp comparison.
 */
export class BackfillReportedBugFindingsFromRoadmap1914000000000 implements MigrationInterface {
  name = 'BackfillReportedBugFindingsFromRoadmap1914000000000';

  private static readonly TAG = 'backfill-1914000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "bug_findings"
        ("source", "title", "description", "reported_bug_id", "status", "metadata", "createdAt", "updatedAt")
       SELECT
        'reported_bug',
        LEFT(ro."description", 200),
        ro."description",
        ro."id",
        'new',
        jsonb_build_object('backfilledBy', $1::text),
        ro."createdAt",
        now()
       FROM "roadmap_opportunities" ro
       WHERE ro."type" = 'bug'
         AND ro."stage" IN ('new', 'prioritised')
         AND ro."deletedAt" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM "bug_findings" bf WHERE bf."reported_bug_id" = ro."id"
         )`,
      [BackfillReportedBugFindingsFromRoadmap1914000000000.TAG],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "bug_findings" WHERE "metadata" ->> 'backfilledBy' = $1`,
      [BackfillReportedBugFindingsFromRoadmap1914000000000.TAG],
    );
  }
}
