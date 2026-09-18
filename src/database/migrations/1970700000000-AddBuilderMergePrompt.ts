import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When Builder offered a merge button for a pull request.
 *
 * Additive and nullable: an ally-be that has not shipped the Slack control
 * reads every row as "never offered", which is exactly right.
 */
export class AddBuilderMergePrompt1970700000000 implements MigrationInterface {
  name = 'AddBuilderMergePrompt1970700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "mergePromptedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "mergePromptedAt"`,
    );
  }
}
