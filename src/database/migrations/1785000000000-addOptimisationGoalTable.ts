import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOptimisationGoalTable1785000000000 implements MigrationInterface {
  name = 'AddOptimisationGoalTable1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "optimisation_goals" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "category" character varying NOT NULL, "description" text, "createdBy" integer, CONSTRAINT "PK_optimisation_goals_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "optimisation_goals"`);
  }
}
