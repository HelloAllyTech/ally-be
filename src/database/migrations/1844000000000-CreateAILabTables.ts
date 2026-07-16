import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI Lab schema: skills (system-prompt templates), variables (unique
 * placeholders referenced in templates as {{name}}), and values (candidate
 * substitutions bound to a variable). System-wide, super-duper-admin managed.
 */
export class CreateAILabTables1844000000000 implements MigrationInterface {
  name = 'CreateAILabTables1844000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lab_skills" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" text NOT NULL,
        "description" text,
        "content" text NOT NULL,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_skills_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_skills_name" ON "lab_skills" ("name")`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_variables" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(255) NOT NULL,
        "description" text,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_variables_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_lab_variables_name" ON "lab_variables" ("name")`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_values" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "variable_id" uuid NOT NULL,
        "label" text,
        "value" text NOT NULL,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_values_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lab_values_variable_id" FOREIGN KEY ("variable_id")
          REFERENCES "lab_variables" ("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_values_variable_id" ON "lab_values" ("variable_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_lab_values_variable_id"`);
    await queryRunner.query(`DROP TABLE "lab_values"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lab_variables_name"`);
    await queryRunner.query(`DROP TABLE "lab_variables"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lab_skills_name"`);
    await queryRunner.query(`DROP TABLE "lab_skills"`);
  }
}
