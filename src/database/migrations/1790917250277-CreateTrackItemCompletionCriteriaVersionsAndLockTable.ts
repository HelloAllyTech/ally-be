import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrackItemCompletionCriteriaVersionsAndLockTable1790917250277
  implements MigrationInterface
{
  name = 'CreateTrackItemCompletionCriteriaVersionsAndLockTable1790917250277';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "track_item_completion_criteria_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "track_item_id" uuid NOT NULL, "completion_criteria" jsonb NOT NULL, "created_by_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_track_item_completion_criteria_versions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_item_completion_criteria_versions_track_item_id" ON "track_item_completion_criteria_versions" ("track_item_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "track_item_progress_criteria_lock" ("track_item_progress_id" uuid NOT NULL, "criteria_version_id" uuid NOT NULL, CONSTRAINT "PK_track_item_progress_criteria_lock_progress_id" PRIMARY KEY ("track_item_progress_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_item_progress_criteria_lock_criteria_version_id" ON "track_item_progress_criteria_lock" ("criteria_version_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_track_item_progress_criteria_lock_criteria_version_id"`);
    await queryRunner.query(`DROP TABLE "track_item_progress_criteria_lock"`);
    await queryRunner.query(`DROP INDEX "public"."idx_track_item_completion_criteria_versions_track_item_id"`);
    await queryRunner.query(`DROP TABLE "track_item_completion_criteria_versions"`);
  }
}
