import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a Builder session started from a roadmap opportunity begin where the opportunity's
 * filing interview ended, instead of re-asking what the filer already decided.
 *
 * ## roadmap_opportunities."interviewTranscript" — jsonb array, nullable
 *
 * The copilot conversation an opportunity was filed from, `[{role, content}]`. Until now the
 * interview was stateless and the conversation was discarded at filing; only the description
 * and the brief survived it. NULL means "filed without one" — everything before this, quick-adds,
 * bug reports, split/merge results and the importer. No empty-array default for the same reason
 * the brief has none: `[]` would claim a conversation took place and said nothing.
 *
 * ## builder_sessions."handoffContext" — text, nullable
 *
 * What the module that started a session hands it, rendered to text by that module (today the
 * roadmap: opportunity + brief + transcript). Builder reads it as opaque text and renders it into
 * the interview's cached system prefix. Its own column rather than a `metadata` key because the
 * interview-summary writer replaces `metadata` wholesale from a copy it loaded earlier.
 *
 * ## The CHECKs bound size, not content
 *
 * Content is normalised on write (normaliseFilingInterview caps a message at the interview
 * route's 4,000 characters and the count at its 60 plus one; BuilderSessionService caps the
 * hand-off at BUILDER_HANDOFF_CONTEXT_MAX). The CHECKs are what stop either column becoming
 * unbounded if a future write path forgets that. No subquery or set-returning function in
 * either: PostgreSQL refuses both in a CHECK at parse time.
 */
export class AddBuilderRoadmapHandoff1978600000000 implements MigrationInterface {
  name = 'AddBuilderRoadmapHandoff1978600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD COLUMN IF NOT EXISTS "interviewTranscript" jsonb`,
    );
    // 61 messages x 4,000 characters is 244,000 characters of content; the bound leaves room for
    // the JSON around it and its escapes.
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opportunities_interview_transcript" ` +
        `CHECK ("interviewTranscript" IS NULL OR (jsonb_typeof("interviewTranscript") = 'array' ` +
        `AND char_length("interviewTranscript"::text) <= 600000))`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD COLUMN IF NOT EXISTS "handoffContext" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD CONSTRAINT "CHK_builder_sessions_handoff_context" ` +
        `CHECK ("handoffContext" IS NULL OR char_length("handoffContext") <= 120000)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_handoff_context"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP COLUMN IF EXISTS "handoffContext"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_interview_transcript"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN IF EXISTS "interviewTranscript"`,
    );
  }
}
