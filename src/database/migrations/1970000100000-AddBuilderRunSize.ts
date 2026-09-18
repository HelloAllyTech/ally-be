import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_build_runs.size` — what the classifier made of the PRD.
 *
 * The run row already records which coder, planner and verifier model ran. On
 * their own those columns cannot answer the question anyone actually asks of
 * them: does a small build succeed on the cheap tier? Size is the input that
 * chose the planner tier, the effort, the turn caps and the budgets, and
 * without it the scoreboard can report cost by model and outcomes by status
 * but can never join the two into "this tier is enough for this kind of work".
 *
 * A column rather than a second classifier. The sizing pass already runs at
 * exactly the moment a model decision would be made — right after the
 * interview, on `startBuild` — so widening model selection later is a change
 * to one profile table. What is missing is not a mechanism, it is evidence,
 * and this is what starts collecting it.
 *
 * Nullable: runs dispatched before this migration were sized, but nothing
 * wrote it down, and backfilling a guess would be worse than an honest null.
 */
export class AddBuilderRunSize1970000100000 implements MigrationInterface {
  name = 'AddBuilderRunSize1970000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" ADD COLUMN IF NOT EXISTS "size" character varying(8)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "size"`,
    );
  }
}
