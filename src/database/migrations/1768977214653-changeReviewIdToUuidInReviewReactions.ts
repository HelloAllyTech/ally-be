import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeReviewIdToUuidInReviewReactions1768977214653 implements MigrationInterface {
  name = 'ChangeReviewIdToUuidInReviewReactions1768977214653';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_reactions" ALTER COLUMN "reviewId" TYPE uuid USING "reviewId"::uuid::uuid;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_reactions" ALTER COLUMN "reviewId" TYPE varchar USING "reviewId"::varchar;`,
    );
  }
}
