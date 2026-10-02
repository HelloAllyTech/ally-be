import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the readiness override, and the three prompts only the retired filing form called.
 *
 * WHY: the admin board's blank "New opportunity" form — a text box, a run-it-yourself readiness
 * check, and a manager-only toggle to file against red rows — was removed. The guided interview
 * is now the only way to file an idea, and it grades the same five criteria as it goes and only
 * hands over a draft that passes them, so there is no verdict left for anyone to override.
 * `POST /opportunities` stopped accepting `readinessOverride` in the same change, so nothing can
 * write these columns any more.
 *
 * ## The columns go, history and all
 *
 * Dropped rather than left write-never, by decision: they were never on the response DTO, so no
 * screen ever read them, and a column nothing writes or reads is a schema fact every future
 * reader of this table has to work out is dead. The record of past overrides (who waved what
 * through, and which items were red) goes with them. `down` restores the shape, not the data.
 *
 * ## The prompts
 *
 * `roadmap_readiness_check` graded the form's draft; `roadmap_review_draft` and
 * `roadmap_enhance_draft` backed its Review and Improve-wording buttons, deprecated long before
 * and serving no caller. Their files are deleted in the same change, but PromptsSyncService only
 * ever creates and updates rows from files — it never deletes one — so without this the three
 * rows would linger in Prompt Management, editable, pointing at nothing. Versions first, because
 * they reference the prompt row. Not restored by `down`: the files they were synced from no
 * longer exist, so there is nothing truthful to restore them from.
 */
export class DropRoadmapReadinessOverride1975300000000 implements MigrationInterface {
  name = 'DropRoadmapReadinessOverride1975300000000';

  private static readonly RETIRED_PROMPT_CODES = [
    'roadmap_readiness_check',
    'roadmap_review_draft',
    'roadmap_enhance_draft',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_roadmap_opps_readiness_overridden"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS ` +
        `"CHK_roadmap_opportunities_readiness_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "readinessFailedCriteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "readinessOverriddenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "readinessOverriddenBy"`,
    );

    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
           USING "prompts" p
           WHERE pv."promptId" = p."id" AND p."promptCode" = ANY($1)`,
      [DropRoadmapReadinessOverride1975300000000.RETIRED_PROMPT_CODES],
    );
    await queryRunner.query(
      `DELETE FROM "prompts" WHERE "promptCode" = ANY($1)`,
      [DropRoadmapReadinessOverride1975300000000.RETIRED_PROMPT_CODES],
    );
  }

  /** The shape of 1952000000000, empty. See the docblock for why the data and prompts are not. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "readinessOverriddenBy" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "readinessOverriddenAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN "readinessFailedCriteria" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT ` +
        `"CHK_roadmap_opportunities_readiness_override" CHECK (` +
        `("readinessOverriddenBy" IS NULL AND "readinessOverriddenAt" IS NULL) OR ` +
        `("readinessOverriddenBy" IS NOT NULL AND "readinessOverriddenAt" IS NOT NULL))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_readiness_overridden" ON "roadmap_opportunities" ` +
        `("readinessOverriddenAt") WHERE "readinessOverriddenBy" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }
}
