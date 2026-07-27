import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-language runtime model override for the MULTILINGUAL path.
 *
 * When a session serves a translated prompt body for a language, these let an
 * admin also pick which LLM runs the main agent for that language (a translated
 * Hindi prompt may do best on a different model than Tamil). Null = inherit the
 * prompt's own provider/model. Distinct from `provider`/`model` on the same
 * table, which record the engine that PRODUCED the translation.
 *
 * Idempotent (IF NOT EXISTS) so it is safe against drifted/shared databases.
 */
export class AddRuntimeModelToPromptTranslations1856000000000 implements MigrationInterface {
  name = 'AddRuntimeModelToPromptTranslations1856000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompt_translations" ADD COLUMN IF NOT EXISTS "runtimeProvider" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompt_translations" ADD COLUMN IF NOT EXISTS "runtimeModel" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompt_translations" DROP COLUMN IF EXISTS "runtimeModel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompt_translations" DROP COLUMN IF EXISTS "runtimeProvider"`,
    );
  }
}
