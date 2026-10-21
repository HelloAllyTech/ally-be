import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When a pull request's release landed, and when Builder checked that the
 * service was healthy after it (BuilderPullRequestService.checkReleaseHealth).
 * `releaseState` gains `unhealthy` — a free-text column, so no constraint moves.
 */
export class BuilderReleaseHealth1977900000000 implements MigrationInterface {
  name = 'BuilderReleaseHealth1977900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests"
         ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP,
         ADD COLUMN IF NOT EXISTS "releaseHealthCheckedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests"
         DROP COLUMN IF EXISTS "releaseHealthCheckedAt",
         DROP COLUMN IF EXISTS "releasedAt"`,
    );
  }
}
