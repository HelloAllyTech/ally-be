import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns on the thinking-filler back-channel for every existing scenario.
 * Thinking Filler is being made on-by-default across the board.
 */
export class EnableThinkingFillerByDefault1931000000000 implements MigrationInterface {
  name = 'EnableThinkingFillerByDefault1931000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"fillerEnabled":true}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = '{"fillerEnabled":true}'::jsonb
        WHERE "metadata" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"fillerEnabled":false}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
  }
}
