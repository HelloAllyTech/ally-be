import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameReviewToScenarioSessionReview1772710346449 implements MigrationInterface {
  name = 'RenameReviewToScenarioSessionReview1772710346449';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reviews" RENAME TO "scenario_session_reviews"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_threads" RENAME TO "scenario_session_review_threads"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_comments" RENAME TO "scenario_session_review_comments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reactions" RENAME TO "scenario_session_review_reactions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_comment_reactions" RENAME TO "scenario_session_review_comment_reactions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_read_status" RENAME TO "scenario_session_review_read_status"`,
    );

    await queryRunner.query(
      `ALTER INDEX "uq_review_read_status_user_id_review_id_idx" RENAME TO "uq_scenario_session_review_read_status_user_review_idx"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER INDEX "uq_scenario_session_review_read_status_user_review_idx" RENAME TO "uq_review_read_status_user_id_review_id_idx"`,
    );

    await queryRunner.query(
      `ALTER TABLE "scenario_session_review_read_status" RENAME TO "review_read_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_review_comment_reactions" RENAME TO "review_comment_reactions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_review_reactions" RENAME TO "review_reactions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_review_comments" RENAME TO "review_comments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_review_threads" RENAME TO "review_threads"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_reviews" RENAME TO "reviews"`,
    );
  }
}
