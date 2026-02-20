import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBehaviorTranslationsTables1771417016627 implements MigrationInterface {
  name = 'AddBehaviorTranslationsTables1771417016627';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_behavior_instruction_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioBehaviorInstructionId" uuid NOT NULL, "languageId" integer NOT NULL, "instructions" text array NOT NULL, CONSTRAINT "PK_df9c042257c42092006ac1ecc27" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_sbi_translations_instruction_id_language_id_idx" ON "scenario_behavior_instruction_translations" ("scenarioBehaviorInstructionId", "languageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "behavior_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "behaviorId" uuid NOT NULL, "languageId" integer NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_1fc19f606ca5bff6e7d02005d0c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_behavior_translations_behavior_id_language_id_idx" ON "behavior_translations" ("behaviorId", "languageId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_behavior_translations_behavior_id_language_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "behavior_translations"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_sbi_translations_instruction_id_language_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE "scenario_behavior_instruction_translations"`,
    );
  }
}
