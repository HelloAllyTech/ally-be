import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An outstanding `/oc` fix request on an opencode pull request: the head it
 * was made against and when. See BuilderPullRequest.fixRequestedSha.
 */
export class BuilderPullRequestFixRequest1976700000000 implements MigrationInterface {
  name = 'BuilderPullRequestFixRequest1976700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "fixRequestedSha" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "fixRequestedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "fixRequestedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "fixRequestedSha"`,
    );
  }
}
