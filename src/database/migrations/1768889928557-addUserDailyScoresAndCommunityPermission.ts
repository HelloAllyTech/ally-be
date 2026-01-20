import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDailyScoresAndCommunityPermission1768889928557 implements MigrationInterface {
  name = 'AddUserDailyScoresAndCommunityPermission1768889928557';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_daily_scores" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "date" date NOT NULL, "minutesPlayed" integer NOT NULL DEFAULT '0', "totalScore" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_d2a368bf5304d0ecbf95a807e16" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "user_daily_scores_tenant_id_date_idx" ON "user_daily_scores" ("tenant_id", "date") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_daily_scores_user_id_tenant_id_date_idx" ON "user_daily_scores" ("userId", "tenant_id", "date") `,
    );

    await queryRunner.query(
      `INSERT INTO "permissions" ("name") VALUES ('view:community:leaderboard'), ('view:user:rank')`,
    );

    await queryRunner.query(
      `INSERT INTO "group_permissions" ("groupId", "permissionId") SELECT g.id, p.id FROM "groups" g, "permissions" p WHERE g.name = 'LEARNER' AND p.name IN ('view:community:leaderboard', 'view:user:rank')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name IN ('view:community:leaderboard', 'view:user:rank'))`,
    );

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN ('view:community:leaderboard', 'view:user:rank')`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."uq_user_daily_scores_user_id_tenant_id_date_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."user_daily_scores_tenant_id_date_idx"`,
    );
    await queryRunner.query(`DROP TABLE "user_daily_scores"`);
  }
}
