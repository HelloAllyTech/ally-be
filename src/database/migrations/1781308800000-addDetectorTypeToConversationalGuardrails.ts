import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add a detectorType axis (CATEGORY/COHERENCE) to guardrails, separate from
 * kind (USER/SYSTEM). kind = governance (always-on/locked); detectorType =
 * which classifier the agent uses. Existing guardrails default to CATEGORY;
 * the seeded STT Coherence Guard is set to COHERENCE.
 */
export class AddDetectorTypeToConversationalGuardrails1781308800000 implements MigrationInterface {
  name = 'AddDetectorTypeToConversationalGuardrails1781308800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         CREATE TYPE "conversational_guardrails_detector_type_enum" AS ENUM ('CATEGORY', 'COHERENCE');
       EXCEPTION
         WHEN duplicate_object THEN null;
       END $$;`,
    );

    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails"
       ADD COLUMN IF NOT EXISTS "detectorType" "conversational_guardrails_detector_type_enum"
       NOT NULL DEFAULT 'CATEGORY'`,
    );

    await queryRunner.query(
      `UPDATE "conversational_guardrails"
       SET "detectorType" = 'COHERENCE'
       WHERE "kind" = 'SYSTEM' AND "name" = 'STT Coherence Guard'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" DROP COLUMN IF EXISTS "detectorType"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "conversational_guardrails_detector_type_enum"`,
    );
  }
}
