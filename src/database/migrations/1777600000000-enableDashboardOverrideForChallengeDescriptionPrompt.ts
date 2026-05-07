import { MigrationInterface, QueryRunner } from 'typeorm';

const PROMPT_CODE = 'openai_simulation_challenge_description';

/**
 * The challenge_description prompt template lives BOTH on disk
 * (src/prompts/openai_simulation/challenge_description.txt) AND in the prompts /
 * prompts_versions tables. PromptSharedService.getPromptByCode prefers the on-disk
 * file when prompts.useDashboardOverride is false, so the language-aware v2 template
 * inserted by 1777500000000-updateChallengeDescriptionPromptLanguageAware was being
 * ignored at runtime.
 *
 * Flipping useDashboardOverride to true makes the resolver read prompts_versions at
 * currentVersion (= 2), which is the language-aware template required for per-language
 * regeneration of the Challenge Description.
 */
export class EnableDashboardOverrideForChallengeDescriptionPrompt1777600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "useDashboardOverride" = true WHERE "promptCode" = $1`,
      [PROMPT_CODE],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "useDashboardOverride" = false WHERE "promptCode" = $1`,
      [PROMPT_CODE],
    );
  }
}
