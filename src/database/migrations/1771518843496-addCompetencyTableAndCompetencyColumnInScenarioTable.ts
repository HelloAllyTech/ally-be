import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompetencyTableAndCompetencyColumnInScenarioTable1771518843496 implements MigrationInterface {
  name = 'AddCompetencyTableAndCompetencyColumnInScenarioTable1771518843496';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "competencies" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "createdBy" integer, CONSTRAINT "PK_0b29ecda233cc61de0d93527813" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "scenarios" ADD "competencyId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "competencyId"`,
    );
    await queryRunner.query(`DROP TABLE "competencies"`);
  }
}
