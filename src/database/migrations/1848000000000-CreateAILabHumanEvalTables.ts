import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI Lab human evaluation:
 * - lab_runs.published_at — set once when a COMPLETED run is published for
 *   human evaluation (with >= 1 question).
 * - lab_eval_questions — the questions attached at publish time
 *   (RATING / YES_NO / TEXT; rating carries an inclusive scale).
 * - lab_evaluators — standalone evaluator accounts (email + password hash;
 *   NOT platform users), managed by super-duper-admins.
 * - lab_run_assignments — published run ↔ evaluator; submitted_at flips once
 *   on submission, after which the evaluation is immutable.
 * - lab_eval_answers — one row per (assignment, question), written atomically
 *   with submitted_at.
 */
export class CreateAILabHumanEvalTables1848000000000 implements MigrationInterface {
  name = 'CreateAILabHumanEvalTables1848000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD COLUMN "published_at" TIMESTAMP`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_eval_questions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid NOT NULL,
        "question" text NOT NULL,
        "type" character varying(20) NOT NULL,
        "scale_min" integer NOT NULL DEFAULT 1,
        "scale_max" integer NOT NULL DEFAULT 5,
        "position" integer NOT NULL DEFAULT 0,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_eval_questions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lab_eval_questions_run_id" FOREIGN KEY ("run_id")
          REFERENCES "lab_runs" ("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_eval_questions_run_id" ON "lab_eval_questions" ("run_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_evaluators" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(320) NOT NULL,
        "password_hash" text NOT NULL,
        "token_version" integer NOT NULL DEFAULT 0,
        "last_login_at" TIMESTAMP,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_evaluators_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_lab_evaluators_email" ON "lab_evaluators" ("email")`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_run_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid NOT NULL,
        "evaluator_id" uuid NOT NULL,
        "submitted_at" TIMESTAMP,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_run_assignments_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lab_run_assignments_run_evaluator" UNIQUE ("run_id", "evaluator_id"),
        CONSTRAINT "FK_lab_run_assignments_run_id" FOREIGN KEY ("run_id")
          REFERENCES "lab_runs" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_lab_run_assignments_evaluator_id" FOREIGN KEY ("evaluator_id")
          REFERENCES "lab_evaluators" ("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_run_assignments_run_id" ON "lab_run_assignments" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_run_assignments_evaluator_id" ON "lab_run_assignments" ("evaluator_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_eval_answers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "assignment_id" uuid NOT NULL,
        "question_id" uuid NOT NULL,
        "answer_text" text,
        "answer_rating" integer,
        "answer_bool" boolean,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_eval_answers_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lab_eval_answers_assignment_question" UNIQUE ("assignment_id", "question_id"),
        CONSTRAINT "FK_lab_eval_answers_assignment_id" FOREIGN KEY ("assignment_id")
          REFERENCES "lab_run_assignments" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_lab_eval_answers_question_id" FOREIGN KEY ("question_id")
          REFERENCES "lab_eval_questions" ("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_eval_answers_question_id" ON "lab_eval_answers" ("question_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_lab_eval_answers_question_id"`,
    );
    await queryRunner.query(`DROP TABLE "lab_eval_answers"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_lab_run_assignments_evaluator_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_lab_run_assignments_run_id"`,
    );
    await queryRunner.query(`DROP TABLE "lab_run_assignments"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lab_evaluators_email"`);
    await queryRunner.query(`DROP TABLE "lab_evaluators"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_lab_eval_questions_run_id"`,
    );
    await queryRunner.query(`DROP TABLE "lab_eval_questions"`);
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP COLUMN "published_at"`,
    );
  }
}
