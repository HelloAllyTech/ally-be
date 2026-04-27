import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomFieldTables1776300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "custom_field_type_enum" AS ENUM ('SINGLE_SELECT', 'DATE')
    `);

    await queryRunner.query(`
      CREATE TYPE "custom_field_edit_permission_enum" AS ENUM (
        'ADMIN_ONLY',
        'COUNSELLOR_ONLY',
        'BOTH'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "custom_field_fill_mode_enum" AS ENUM ('MANUAL', 'AI')
    `);

    await queryRunner.query(`
      CREATE TABLE "custom_field_definitions" (
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id"       VARCHAR NOT NULL,
        "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
        "name"            VARCHAR NOT NULL,
        "fieldType"       "custom_field_type_enum" NOT NULL,
        "options"         JSONB,
        "sectionKey"      VARCHAR NOT NULL,
        "editPermission"  "custom_field_edit_permission_enum" NOT NULL DEFAULT 'BOTH',
        "fillMode"        "custom_field_fill_mode_enum" NOT NULL DEFAULT 'MANUAL',
        "displayOrder"    INTEGER NOT NULL DEFAULT 0,
        "showInTable"     BOOLEAN NOT NULL DEFAULT true,
        "isActive"        BOOLEAN NOT NULL DEFAULT true,
        "createdBy"       INTEGER NOT NULL,
        "updatedBy"       INTEGER NOT NULL,
        CONSTRAINT "pk_custom_field_definitions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_custom_field_definitions_tenant_active"
        ON "custom_field_definitions" ("tenant_id", "isActive")
    `);

    await queryRunner.query(`
      CREATE TABLE "chat_custom_field_values" (
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id"           VARCHAR NOT NULL,
        "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
        "chatId"              INTEGER NOT NULL,
        "fieldDefinitionId"   UUID NOT NULL,
        "value"               VARCHAR,
        "updatedBy"           INTEGER NOT NULL,
        CONSTRAINT "pk_chat_custom_field_values" PRIMARY KEY ("id"),
        CONSTRAINT "fk_chat_custom_field_values_definition"
          FOREIGN KEY ("fieldDefinitionId")
          REFERENCES "custom_field_definitions" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "uq_chat_custom_field_values_chat_field"
          UNIQUE ("chatId", "fieldDefinitionId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_chat_custom_field_values_tenant_chat"
        ON "chat_custom_field_values" ("tenant_id", "chatId")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_chat_custom_field_values_tenant_field"
        ON "chat_custom_field_values" ("tenant_id", "fieldDefinitionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_custom_field_values"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_field_definitions"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "custom_field_fill_mode_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "custom_field_edit_permission_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "custom_field_type_enum"`);
  }
}
