import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `track_annotation_attempts` — per-attempt storage for the ANNOTATED_ARTIFACT
 * ("Annotation") component, where a learner marks lines of a real transcript
 * or note with author-defined labels.
 *
 * Shaped after `track_quiz_attempts`, minus its `status` column: annotation
 * grading is pure set comparison against the author's key, so it is always
 * synchronous — an attempt is never PENDING_GRADING and there is nothing to
 * regrade.
 *
 * `grading` stores the FULL result including misses and the author's notes;
 * reveal gating happens on read (see buildAnnotationAttemptView), never by
 * withholding data at write time, so a learner who later earns the reveal can
 * see the key for an attempt they already made.
 *
 * Loose-FK convention, matching the other track tables: bare columns + partial
 * indexes, no DB constraints.
 */
export class CreateTrackAnnotationAttempts1907000000000 implements MigrationInterface {
  name = 'CreateTrackAnnotationAttempts1907000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "track_annotation_attempts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackItemProgressId" uuid NOT NULL, "trackItemId" uuid NOT NULL, "userId" integer NOT NULL, "attemptNumber" integer NOT NULL, "marks" jsonb NOT NULL, "grading" jsonb, "scorePct" numeric, "passed" boolean, "submittedAt" TIMESTAMP, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_annotation_attempts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_annotation_attempts_progress_id" ON "track_annotation_attempts" ("trackItemProgressId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_annotation_attempts_progress_id"`,
    );
    await queryRunner.query(`DROP TABLE "track_annotation_attempts"`);
  }
}
