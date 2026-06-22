import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompetencyBehaviorsTable1786000000000 implements MigrationInterface {
  name = 'AddCompetencyBehaviorsTable1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "competency_behaviors" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "competencyId" uuid NOT NULL, "behaviorId" uuid NOT NULL, "type" character varying NOT NULL, CONSTRAINT "PK_competency_behaviors_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_competency_behaviors_competency_behavior" UNIQUE ("competencyId", "behaviorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_competency_behaviors_competencyId" ON "competency_behaviors" ("competencyId")`,
    );
    // FKs with cascade so deleting a competency (or behaviour) cleans up its
    // mapping rows instead of leaving orphans.
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" ADD CONSTRAINT "FK_competency_behaviors_competency" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" ADD CONSTRAINT "FK_competency_behaviors_behavior" FOREIGN KEY ("behaviorId") REFERENCES "behaviors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" DROP CONSTRAINT "FK_competency_behaviors_behavior"`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" DROP CONSTRAINT "FK_competency_behaviors_competency"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_competency_behaviors_competencyId"`,
    );
    await queryRunner.query(`DROP TABLE "competency_behaviors"`);
  }
}
