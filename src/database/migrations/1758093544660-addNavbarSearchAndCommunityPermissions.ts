import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNavbarSearchAndCommunityPermissions1758093544660 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Assign view:admin:scenario-session permission to admin and remove it from learner
    await queryRunner.query(`
        DELETE FROM "group_permissions" WHERE "permissionId" = (
            SELECT id FROM "permissions" WHERE name IN ('view:admin:scenario-session')
        ) AND "groupId" = (
            SELECT id FROM "groups" WHERE name = 'LEARNER'
        )
    `);

    await queryRunner.query(`
        INSERT INTO "group_permissions" ("groupId", "permissionId")
        SELECT id, (SELECT id FROM "permissions" WHERE name = 'view:admin:scenario-session') FROM "groups" WHERE name = 'ADMIN'
    `);

    // Add permissions for searxh and community nav bar
    await queryRunner.query(`
            INSERT INTO "permissions" ("name") VALUES 
            ('view:navbar:search'),
            ('view:navbar:community')
        `);

    // Assign both view:navbar:search and view:navbar:community permissions to both counselor and admin
    await queryRunner.query(`
        WITH group_details AS (
            SELECT id 
            FROM "groups" 
            WHERE name IN ('COUNSELOR', 'ADMIN')
        )
        INSERT INTO group_permissions ("groupId", "permissionId")
        SELECT 
            group_details.id,
            permissions.id 
        FROM group_details, "permissions" 
        WHERE permissions.name IN (
            'view:navbar:community'
        )
    `);

    await queryRunner.query(`
        WITH group_details AS (
            SELECT id 
            FROM "groups" 
            WHERE name IN ('COUNSELOR')
        )
        INSERT INTO group_permissions ("groupId", "permissionId")
        SELECT 
            group_details.id,
            permissions.id 
        FROM group_details, "permissions" 
        WHERE permissions.name IN (
            'view:navbar:search'
        )
    `);

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

    // Remove permissions for search and community nav bar
    await queryRunner.query(`
        DELETE FROM "group_permissions" WHERE "permissionId" IN (
            SELECT id FROM "permissions" WHERE name IN ('view:navbar:search', 'view:navbar:community')
        ) AND "groupId" IN (
            SELECT id FROM "groups" WHERE name IN ('COUNSELOR', 'ADMIN')
        )
    `);

    // Remove permissions for search and community nav bar
    await queryRunner.query(`
            DELETE FROM "permissions" WHERE name IN ('view:navbar:search', 'view:navbar:community');
        `);

    await queryRunner.query(`
        DELETE FROM "group_permissions" WHERE "permissionId" = (
            SELECT id FROM "permissions" WHERE name IN ('view:admin:scenario-session')
        ) AND "groupId" = (
            SELECT id FROM "groups" WHERE name = 'ADMIN'
        )
    `);

    await queryRunner.query(`INSERT INTO "group_permissions" ("groupId", "permissionId")
        SELECT id, (SELECT id FROM "permissions" WHERE name = 'view:admin:scenario-session') FROM "groups" WHERE name = 'LEARNER'
    `);
  }
}
