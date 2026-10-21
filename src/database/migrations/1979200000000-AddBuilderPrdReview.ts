import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where Builder's cold PRD reviewer keeps what it found.
 *
 * ## builder_prd_docs."review" — jsonb object, nullable
 *
 * `BuilderPrdReview`: the reviewer's findings on the PRD, each open, fixed or dismissed with a
 * reason, plus which PRD version it read and when it last rechecked. NULL until the PRD first
 * reads ready, which is when the review runs.
 *
 * On the doc row rather than inside `draft`: dismissing a finding is not a PRD edit and should
 * not cut a version, and an `update_prd` patch must not be able to rewrite what the reviewer
 * said. The CHECK only insists on an object, so a stray scalar cannot land there and crash the
 * readiness rubric that reads it.
 */
export class AddBuilderPrdReview1979200000000 implements MigrationInterface {
  name = 'AddBuilderPrdReview1979200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_prd_docs" ADD COLUMN IF NOT EXISTS "review" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_prd_docs" DROP CONSTRAINT IF EXISTS "CHK_builder_prd_docs_review_object"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_prd_docs" ADD CONSTRAINT "CHK_builder_prd_docs_review_object"
        CHECK ("review" IS NULL OR jsonb_typeof("review") = 'object')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_prd_docs" DROP CONSTRAINT IF EXISTS "CHK_builder_prd_docs_review_object"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_prd_docs" DROP COLUMN IF EXISTS "review"`,
    );
  }
}
