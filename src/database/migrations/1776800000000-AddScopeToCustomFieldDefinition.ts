import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScopeToCustomFieldDefinition1776800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         CREATE TYPE "custom_field_definitions_scope_enum" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN');
       EXCEPTION
         WHEN duplicate_object THEN null;
       END $$;`,
    );

    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions"
       ADD COLUMN IF NOT EXISTS "scope" "custom_field_definitions_scope_enum"
       NOT NULL DEFAULT 'ORG_ADMIN'`,
    );

    // Backfill: every existing AI-fill definition was created via the scribe
    // settings flow today (the only place that surfaces fillMode=AI), so mark
    // those rows as SUPER_ADMIN. Everything else stays ORG_ADMIN.
    await queryRunner.query(
      `UPDATE "custom_field_definitions"
       SET "scope" = 'SUPER_ADMIN'
       WHERE "fillMode" = 'AI'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" DROP COLUMN IF EXISTS "scope"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "custom_field_definitions_scope_enum"`,
    );
  }
}
