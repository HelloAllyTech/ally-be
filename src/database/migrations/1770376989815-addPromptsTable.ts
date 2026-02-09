import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPromptsTable1770376989815 implements MigrationInterface {
  name = 'AddPromptsTable1770376989815';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "prompts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "promptCode" character varying NOT NULL, "name" character varying NOT NULL, "description" character varying NOT NULL, "currentVersion" integer, CONSTRAINT "PK_21f33798862975179e40b216a1d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_prompts_code_idx" ON "prompts" ("promptCode") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_prompts_name_idx" ON "prompts" ("name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "prompts_versions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "promptId" uuid NOT NULL, "version" integer NOT NULL, "prompt" character varying NOT NULL, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, CONSTRAINT "PK_c24408ab262cbef99cee2e59b99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "prompts_versions_promptId_idx" ON "prompts_versions" ("promptId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_prompts_versions_idx" ON "prompts_versions" ("promptId", "version") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_prompts_versions_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."prompts_versions_promptId_idx"`,
    );
    await queryRunner.query(`DROP TABLE "prompts_versions"`);
    await queryRunner.query(`DROP INDEX "public"."uq_prompts_name_idx"`);
    await queryRunner.query(`DROP INDEX "public"."uq_prompts_code_idx"`);
    await queryRunner.query(`DROP TABLE "prompts"`);
  }
}
