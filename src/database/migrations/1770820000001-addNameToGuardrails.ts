import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNameToGuardrails1770820000001 implements MigrationInterface {
  name = 'AddNameToGuardrails1770820000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" ADD "name" character varying NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" DROP COLUMN "name"`,
    );
  }
}
