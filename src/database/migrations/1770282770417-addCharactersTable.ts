import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharactersTable1770282770417 implements MigrationInterface {
  name = 'AddCharactersTable1770282770417';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_characters" (
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "age" integer NOT NULL,
        "gender" character varying NOT NULL,
        "profession" character varying,
        "current_location" character varying NOT NULL,
        "gender_identity" character varying NOT NULL,
        "sexual_orientation" character varying NOT NULL,
        "created_by" integer NOT NULL,
        "updated_by" integer NOT NULL,
        CONSTRAINT "PK_scenario_characters_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_character_name" ON "scenario_characters" ("name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_character_name"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_characters"`);
  }
}
