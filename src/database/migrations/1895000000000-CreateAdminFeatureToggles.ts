import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-admin-user feature toggles — the data backing the collapse of
 * SUPER_ADMIN / SUPER_DUPER_ADMIN / MULTI_TENANT_ADMIN into a single
 * PLATFORM_ADMIN role (see the follow-up migration
 * CreatePlatformAdminRole1895000000001, which backfills rows here from each
 * migrated user's pre-collapse effective access). One row per
 * (userId, featureKey); missing row = disabled (FeatureToggleGuard fails
 * closed on a missing row, never fails open).
 */
export class CreateAdminFeatureToggles1895000000000 implements MigrationInterface {
  name = 'CreateAdminFeatureToggles1895000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_feature_toggles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL,
        "featureKey" character varying NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_feature_toggles_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_admin_feature_toggles_user_id_feature_key_idx"
       ON "admin_feature_toggles" ("userId", "featureKey")`,
    );
    // Supports "who currently holds feature X" lookups (the admin-editor list,
    // and the last-admin_user_management-holder guard) without a full scan.
    await queryRunner.query(
      `CREATE INDEX "idx_admin_feature_toggles_feature_key_enabled"
       ON "admin_feature_toggles" ("featureKey")
       WHERE "enabled" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_admin_feature_toggles_feature_key_enabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_admin_feature_toggles_user_id_feature_key_idx"`,
    );
    await queryRunner.query(`DROP TABLE "admin_feature_toggles"`);
  }
}
