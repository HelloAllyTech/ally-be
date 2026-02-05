import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanHiddenChatTypesPreference1770193571325 implements MigrationInterface {
  name = 'CleanHiddenChatTypesPreference1770193571325';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "preference"
      SET "value" = COALESCE(
        (
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements_text("preference"."value") AS elem
          WHERE elem NOT IN ('WEBRTC_CHAT', 'EXOTEL_CONFERENCE_CHAT')
        ),
        '[]'::jsonb
      )
      WHERE "name" = 'HIDDEN_CHAT_TYPES'
        AND jsonb_typeof("value") = 'array'
    `);

    // Remove rows where HIDDEN_CHAT_TYPES value is empty array (db cleanup).
    await queryRunner.query(`
      DELETE FROM "preference"
      WHERE "name" = 'HIDDEN_CHAT_TYPES'
        AND ("value" = '[]'::jsonb OR "value" IS NULL)
    `);
  }

  public async down(): Promise<void> {
    // Down migration cannot restore removed WEBRTC_CHAT/EXOTEL_CONFERENCE_CHAT
    // from HIDDEN_CHAT_TYPES or re-insert deleted rows.
  }
}
