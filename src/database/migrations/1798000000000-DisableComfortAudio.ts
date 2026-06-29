import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sets comfortAudioEnabled to false for all existing scenarios.
 * Comfort Audio is being made opt-in (default off) across the board.
 */
export class DisableComfortAudio1798000000000 implements MigrationInterface {
  name = 'DisableComfortAudio1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"comfortAudioEnabled":false}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"comfortAudioEnabled":true}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
  }
}
