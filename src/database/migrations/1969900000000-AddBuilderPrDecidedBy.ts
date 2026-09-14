import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_pull_requests.decided_by` — who merged from the Builder drawer.
 *
 * Builder opens pull requests and stops. On ally-be, ally-web and ally-ai
 * `master` requires an approving review and the bot holds only `write`, so it
 * cannot merge its own work and should not: the human decision and the CI gate
 * are the point. What the agent CAN remove is the errand — Bug Hunter measured
 * 89 of 122 bot pull requests merged by hand, nearly all within the hour of
 * opening, which says the judgement was never the bottleneck.
 *
 * Nullable, and stays null for the common case of a merge done on GitHub. It
 * records a decision made in this UI, not the merge itself.
 */
export class AddBuilderPrDecidedBy1969900000000 implements MigrationInterface {
  name = 'AddBuilderPrDecidedBy1969900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "decidedBy" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "decidedBy"`,
    );
  }
}
