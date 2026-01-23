import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedAtColumnToReviewReactionsAndReviewCommentReactions1768975784921 implements MigrationInterface {
  name =
    'AddDeletedAtColumnToReviewReactionsAndReviewCommentReactions1768975784921';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_reactions" ADD "deletedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_comment_reactions" ADD "deletedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_comment_reactions" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reactions" DROP COLUMN "deletedAt"`,
    );
  }
}
