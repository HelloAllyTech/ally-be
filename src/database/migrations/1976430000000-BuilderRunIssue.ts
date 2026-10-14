import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A build can be a GitHub issue.
 *
 * With BUILDER_DISPATCH=issue, a build run is not a runner Builder starts: it
 * is an issue Builder raises in the target repo, labelled `builder`, which the
 * repo's own `builder.yml` workflow works into a pull request with opencode
 * (`opencode github run`). The run records the issue it raised so the
 * reconcile tick can follow it to that pull request.
 */
export class BuilderRunIssue1976430000000 implements MigrationInterface {
  name = 'BuilderRunIssue1976430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" ADD COLUMN IF NOT EXISTS "issueNumber" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" ADD COLUMN IF NOT EXISTS "issueUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "issueUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "issueNumber"`,
    );
  }
}
