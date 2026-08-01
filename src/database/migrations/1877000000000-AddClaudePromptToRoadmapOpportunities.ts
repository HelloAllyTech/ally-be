import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists the AI-generated Claude Code implementation prompt on the opportunity itself, so it
 * survives a drawer close/reopen instead of being regenerated (and re-billed) every time. Same
 * shape as `prd`: nullable text, ≤20000 chars, plain text/markdown, and edited/saved through the
 * same drawer Save action rather than its own write path.
 */
export class AddClaudePromptToRoadmapOpportunities1877000000000 implements MigrationInterface {
  name = 'AddClaudePromptToRoadmapOpportunities1877000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD COLUMN IF NOT EXISTS "claudePrompt" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD CONSTRAINT "CHK_roadmap_opps_claude_prompt"
        CHECK ("claudePrompt" IS NULL OR char_length("claudePrompt") <= 20000)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        DROP CONSTRAINT IF EXISTS "CHK_roadmap_opps_claude_prompt"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "claudePrompt"
    `);
  }
}
