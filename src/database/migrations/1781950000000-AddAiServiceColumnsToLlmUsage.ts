import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generalizes the (unreleased) `llm_usage` fact table into the unified AI-usage
 * store: adds the `service` dimension ('llm' | 'stt' | 'tts'), the billing
 * `unit`, and the non-token quantities `audioMs` (STT) and `characters` (TTS).
 * Additive — existing rows (if any) default to the LLM/token shape.
 */
export class AddAiServiceColumnsToLlmUsage1781950000000 implements MigrationInterface {
  name = 'AddAiServiceColumnsToLlmUsage1781950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_usage" ADD "service" character varying NOT NULL DEFAULT 'llm'`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_usage" ADD "unit" character varying NOT NULL DEFAULT 'tokens'`,
    );
    await queryRunner.query(`ALTER TABLE "llm_usage" ADD "audioMs" integer`);
    await queryRunner.query(`ALTER TABLE "llm_usage" ADD "characters" integer`);
    await queryRunner.query(
      `CREATE INDEX "llm_usage_service_idx" ON "llm_usage" ("service") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."llm_usage_service_idx"`);
    await queryRunner.query(`ALTER TABLE "llm_usage" DROP COLUMN "characters"`);
    await queryRunner.query(`ALTER TABLE "llm_usage" DROP COLUMN "audioMs"`);
    await queryRunner.query(`ALTER TABLE "llm_usage" DROP COLUMN "unit"`);
    await queryRunner.query(`ALTER TABLE "llm_usage" DROP COLUMN "service"`);
  }
}
