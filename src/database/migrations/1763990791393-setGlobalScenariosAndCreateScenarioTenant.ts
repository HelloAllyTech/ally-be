import { MigrationInterface, QueryRunner } from 'typeorm';

export class SetGlobalScenariosAndCreateScenarioTenant1763990791393
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scenarios 
      SET "isGlobal" = true 
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      INSERT INTO scenario_tenants ("scenarioId", "tenantId")
      SELECT s.id, t.id
      FROM scenarios s
      CROSS JOIN tenants t
      WHERE s."deletedAt" IS NULL 
        AND t."deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM scenario_tenants
    `);

    await queryRunner.query(`
      UPDATE scenarios 
      SET "isGlobal" = false
    `);
  }
}
