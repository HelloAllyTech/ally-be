import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI Lab Question Sets: reusable, named lists of human-evaluation questions
 * that can be applied when publishing a run, instead of (or combined with)
 * ad-hoc questions.
 * - lab_question_sets — draft while published_at is null (freely editable);
 *   published_at is set once and locks the question list; archived_at is a
 *   reversible toggle (published sets only) that hides a set from the
 *   run-publish picker without deleting it.
 * - lab_question_set_questions — the set's own questions (RATING / YES_NO /
 *   TEXT, same shape as lab_eval_questions), replaced wholesale while the set
 *   is still a draft.
 * - lab_eval_questions.source_question_set_id — nullable back-reference so a
 *   run's published questions can be traced to the set they were imported
 *   from (set on SET NULL so archiving/never-deleting a published set is
 *   safe, and a draft set — never referenced, since only published sets are
 *   importable — can still be hard-deleted).
 */
export class CreateLabQuestionSets1873000000000 implements MigrationInterface {
  name = 'CreateLabQuestionSets1873000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lab_question_sets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" text NOT NULL,
        "description" text,
        "published_at" TIMESTAMP,
        "archived_at" TIMESTAMP,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_question_sets_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_question_sets_name" ON "lab_question_sets" ("name")`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_question_set_questions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "question_set_id" uuid NOT NULL,
        "question" text NOT NULL,
        "type" character varying(20) NOT NULL,
        "scale_min" integer NOT NULL DEFAULT 1,
        "scale_max" integer NOT NULL DEFAULT 5,
        "position" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_question_set_questions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lab_question_set_questions_set_id" FOREIGN KEY ("question_set_id")
          REFERENCES "lab_question_sets" ("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_question_set_questions_set_id" ON "lab_question_set_questions" ("question_set_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "lab_eval_questions" ADD COLUMN "source_question_set_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_eval_questions" ADD CONSTRAINT "FK_lab_eval_questions_source_question_set_id"
        FOREIGN KEY ("source_question_set_id") REFERENCES "lab_question_sets" ("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_eval_questions_source_question_set_id" ON "lab_eval_questions" ("source_question_set_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_lab_eval_questions_source_question_set_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_eval_questions" DROP CONSTRAINT "FK_lab_eval_questions_source_question_set_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_eval_questions" DROP COLUMN "source_question_set_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_lab_question_set_questions_set_id"`,
    );
    await queryRunner.query(`DROP TABLE "lab_question_set_questions"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lab_question_sets_name"`);
    await queryRunner.query(`DROP TABLE "lab_question_sets"`);
  }
}
