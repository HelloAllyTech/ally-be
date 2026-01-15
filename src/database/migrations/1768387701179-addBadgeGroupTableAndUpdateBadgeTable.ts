import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBadgeGroupTableAndUpdateBadgeTable1768387701179
  implements MigrationInterface
{
  name = 'AddBadgeGroupTableAndUpdateBadgeTable1768387701179';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "badge_groups" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "badgeId" uuid NOT NULL, "groupId" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_d2a3b2c7eb4ee5651808bbc97ee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_badge_groups_group_id_badge_id_idx" ON "badge_groups" ("groupId", "badgeId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "badges" DROP COLUMN "achievementCriteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "badges" ADD "category" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "badges" ADD "achievementParams" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "badges" DROP COLUMN "achievementParams"`,
    );
    await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN "category"`);
    await queryRunner.query(
      `ALTER TABLE "badges" ADD "achievementCriteria" jsonb`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_badge_groups_group_id_badge_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "badge_groups"`);
  }
}
