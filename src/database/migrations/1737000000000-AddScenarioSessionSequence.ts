import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionSequence1737000000000
  implements MigrationInterface
{
  name = 'AddScenarioSessionSequence1737000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the sequence for scenario sessions
    await queryRunner.query(`
      CREATE SEQUENCE scenario_sessions_id_seq
      START WITH 1
      INCREMENT BY 1
      NO MINVALUE
      NO MAXVALUE;
    `);

    // Create a function to automatically increment the sequence and update metadata
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION auto_increment_session_sequence()
      RETURNS TRIGGER AS $$
      DECLARE
        session_id_val INTEGER;
      BEGIN
        -- Get the next sequence value
        session_id_val := nextval('scenario_sessions_id_seq');     
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create the trigger to automatically call the function on INSERT
    await queryRunner.query(`
      CREATE TRIGGER auto_increment_session_trigger
      BEFORE INSERT ON scenario_sessions
      FOR EACH ROW
      EXECUTE FUNCTION auto_increment_session_sequence();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the trigger
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS auto_increment_session_trigger ON scenario_sessions;
    `);

    // Drop the function
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS auto_increment_session_sequence();
    `);

    // Drop the sequence
    await queryRunner.query(`
      DROP SEQUENCE IF EXISTS scenario_sessions_id_seq;
    `);
  }
}
