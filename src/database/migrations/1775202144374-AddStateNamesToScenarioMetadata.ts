import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStateNamesToScenarioMetadata1775202144374 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const defaultStateNames = JSON.stringify([
      { stateId: '-1', name: 'State -1' },
      { stateId: '1', name: 'State 1' },
      { stateId: '2', name: 'State 2' },
      { stateId: '3', name: 'State 3' },
    ]);

    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = "metadata" || jsonb_build_object('stateNames', '${defaultStateNames}'::jsonb)
      WHERE NOT ("metadata" ? 'stateNames');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // We don't necessarily want to delete valid data in down, but to revert the schema strictly:
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = "metadata" - 'stateNames'
      WHERE "metadata" ? 'stateNames';
    `);
  }
}
