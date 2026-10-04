import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record whether a roleplay session was a voice call or a text chat.
 *
 * Text-chat roleplays run the same persona, events and scoring as voice ones,
 * through the same LiveKit room with audio switched off. Everything downstream
 * (score, transcript, debrief, track gates) is shared, so the only thing that
 * has to be remembered per session is which mode it ran in — for the summary
 * screen (no recording to play back), for analytics, and so a reviewer can
 * tell a typed transcript from a transcribed one.
 *
 * NOT NULL DEFAULT 'VOICE': every existing row is a voice session, and so is
 * every new one unless the start request explicitly asks for TEXT and both the
 * org preference and the scenario allow it. A plain `character varying`, no
 * Postgres enum, matching `endReason`/`abandonedReason` — a future mode is a
 * TypeScript-only change.
 */
export class AddScenarioSessionInteractionMode1975500000000 implements MigrationInterface {
  name = 'AddScenarioSessionInteractionMode1975500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD COLUMN IF NOT EXISTS "interactionMode" character varying(16) NOT NULL DEFAULT 'VOICE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN IF EXISTS "interactionMode"`,
    );
  }
}
