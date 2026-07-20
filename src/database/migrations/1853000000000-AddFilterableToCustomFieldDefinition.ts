import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFilterableToCustomFieldDefinition1853000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Default true so every existing definition (custom + seeded default)
    // becomes filterable on rollout; admins can turn individual fields off.
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions"
       ADD COLUMN IF NOT EXISTS "filterable" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" DROP COLUMN IF EXISTS "filterable"`,
    );
  }
}
