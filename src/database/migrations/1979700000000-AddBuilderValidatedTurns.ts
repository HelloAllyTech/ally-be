import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_settings.validatedTurns`: the switch for Builder's validated interview turns.
 *
 * On, a turn reaches the admin only through a terminal tool (`ask_admin` / `finish_turn`) whose
 * batch read every result and had no failed call, and a message claiming a PRD change or a ready
 * PRD is checked against the document before it is shown. Off, the interview runs the loop it ran
 * before. Defaults on — the change is measured by the replay eval after release, and this is how
 * it is switched back without a deploy if the eval or a live session says it should be.
 */
export class AddBuilderValidatedTurns1979700000000 implements MigrationInterface {
  name = 'AddBuilderValidatedTurns1979700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "validatedTurns" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "validatedTurns"`,
    );
  }
}
