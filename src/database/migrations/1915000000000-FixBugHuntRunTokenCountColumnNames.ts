import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1912000000000 added the run token-count columns as
 * `total_input_tokens` / `total_output_tokens`, but `BugHuntRun` declares them
 * with no explicit `name`, so TypeORM maps them to `"totalInputTokens"` /
 * `"totalOutputTokens"` — the camelCase convention every other column on this
 * table already uses (`foundCount`, `totalTokenCostUsd`, `finishedAt`). The
 * columns Postgres actually got were therefore invisible to the entity, which
 * broke every statement naming them: `startRun`'s INSERT lists all mapped
 * columns, so it failed outright, and with it "Put me on it" (the on-demand
 * fix session opens a run row before dispatching), `POST pipeline/runs`,
 * `.../close`, `.../cost` and `GET runs` — all surfacing as the generic
 * `Database query failed` from CustomExceptionFilter.
 *
 * A rename rather than a column-mapping change on the entity: camelCase is
 * this table's convention, and it makes the already-deployed code correct
 * without waiting for a redeploy.
 */
export class FixBugHuntRunTokenCountColumnNames1915000000000 implements MigrationInterface {
  name = 'FixBugHuntRunTokenCountColumnNames1915000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" RENAME COLUMN "total_input_tokens" TO "totalInputTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" RENAME COLUMN "total_output_tokens" TO "totalOutputTokens"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" RENAME COLUMN "totalOutputTokens" TO "total_output_tokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" RENAME COLUMN "totalInputTokens" TO "total_input_tokens"`,
    );
  }
}
