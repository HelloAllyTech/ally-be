import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBadgeTables1768301641289 implements MigrationInterface {
  name = 'AddBadgeTables1768301641289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "badges" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "imageUrl" text, "status" character varying NOT NULL DEFAULT 'ACTIVE', "visibilityType" character varying NOT NULL DEFAULT 'PUBLIC', "achievementCriteria" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "UQ_48fe47e292737e09162b08c4f7c" UNIQUE ("code"), CONSTRAINT "PK_8a651318b8de577e8e217676466" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "badge_users" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "badgeId" uuid NOT NULL, "viewedStatus" character varying NOT NULL DEFAULT 'UNVIEWED', "deletedAt" TIMESTAMP, CONSTRAINT "PK_671b32b8393d05728748991114a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_badge_users_user_id_badge_id_idx" ON "badge_users" ("userId", "badgeId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "badge_tenants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "badgeId" uuid NOT NULL, "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_a2735ec3179c7c7ed6b2b78cf9a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_badge_tenants_badge_id_tenant_id_idx" ON "badge_tenants" ("badgeId", "tenantId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_badge_tenants_badge_id_tenant_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "badge_tenants"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_badge_users_user_id_badge_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "badge_users"`);
    await queryRunner.query(`DROP TABLE "badges"`);
  }
}
