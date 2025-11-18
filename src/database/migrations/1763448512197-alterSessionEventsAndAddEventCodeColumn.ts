import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterSessionEventsAndAddEventCodeColumn1763448512197
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "session_events"
            ADD COLUMN IF NOT EXISTS "eventCode" character varying UNIQUE;
          `);
    await queryRunner.query(`
            CREATE SEQUENCE session_events_event_code_seq
            START WITH 1
            INCREMENT BY 1
            NO MINVALUE
            NO MAXVALUE;
          `);
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION get_event_code_prefix(detectionType varchar)
            RETURNS varchar AS $$
            BEGIN
              CASE detectionType
                WHEN 'SENTENCE_SIMILARITY' THEN RETURN 'SS';
                WHEN 'SEMANTIC_SIMILARITY' THEN RETURN 'SM';
                WHEN 'TIME' THEN RETURN 'TI';
                WHEN 'SCORE' THEN RETURN 'SC';
                WHEN 'COMBINATION' THEN RETURN 'CO';
                ELSE RETURN 'UN'; -- fallback
              END CASE;
            END;
            $$ LANGUAGE plpgsql;
          `);
    await queryRunner.query(`
            UPDATE session_events
            SET "eventCode" = 
              get_event_code_prefix("detectionType") || 
              LPAD(nextval('session_events_event_code_seq')::text, 4, '0')
            WHERE "eventCode" IS NULL;
          `);
    await queryRunner.query(`
            ALTER TABLE "session_events"
            ALTER COLUMN "eventCode" SET NOT NULL;
          `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        DROP FUNCTION IF EXISTS get_event_code_prefix(varchar);
      `);
    await queryRunner.query(`
        DROP SEQUENCE IF EXISTS session_events_event_code_seq;
      `);
    await queryRunner.query(`
            ALTER TABLE "session_events" 
            DROP COLUMN IF EXISTS "eventCode"
          `);
  }
}
