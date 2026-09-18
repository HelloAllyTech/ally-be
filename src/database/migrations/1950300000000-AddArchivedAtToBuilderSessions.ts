import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a nullable `archivedAt` timestamp to `builder_sessions`, so an admin can
 * hide a finished session from their default Builder feed without deleting
 * anything. Null = active; archiving is reversible and touches this one
 * column only — the PRD, transcript, runs, events, PRs and reports underneath
 * a session are never modified by it.
 *
 * Column is `"archivedAt"` (quoted camelCase), not `archived_at`: every other
 * column on this table follows that convention (`1937000000000`), and the only
 * snake_case exception (`tenant_id`) carries an explicit `name:` on its entity
 * column rather than being the rule.
 *
 * Partial index, matching the two siblings already on this table
 * (`idx_builder_sessions_created_by`, `idx_builder_sessions_status`) — both the
 * default feed's `archivedAt IS NULL` filter and the archived view's
 * `archivedAt IS NOT NULL` filter stay index-backed.
 */
export class AddArchivedAtToBuilderSessions1950300000000 implements MigrationInterface {
  name = 'AddArchivedAtToBuilderSessions1950300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD COLUMN "archivedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_sessions_archived_at" ON "builder_sessions" ("archivedAt") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_builder_sessions_archived_at"`);
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP COLUMN "archivedAt"`,
    );
  }
}
