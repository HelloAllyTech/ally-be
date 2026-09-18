import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generic in-app notification feed (`in_app_notifications`) — the nav-sidebar
 * bell (web) and Notifications screen (mobile). Also doubles as the
 * engagement-reminder evaluator's dedup/cooldown record; see the entity
 * docblock (`src/notification/entity/in-app-notification.entity.ts`).
 */
export class CreateInAppNotifications1964000000000 implements MigrationInterface {
  name = 'CreateInAppNotifications1964000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "in_app_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "userId" integer NOT NULL,
        "type" character varying(50) NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "data" jsonb,
        "readAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_in_app_notifications_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_in_app_notifications_user_type_created" ON "in_app_notifications" ("userId", "type", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_in_app_notifications_user_read" ON "in_app_notifications" ("userId", "readAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_in_app_notifications_user_read"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_in_app_notifications_user_type_created"`,
    );
    await queryRunner.query(`DROP TABLE "in_app_notifications"`);
  }
}
