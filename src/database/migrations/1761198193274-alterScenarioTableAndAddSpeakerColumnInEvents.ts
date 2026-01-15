import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterScenarioTableAndAddSpeakerColumnInEvents1761198193274 implements MigrationInterface {
  name = 'AlterScenarioTableAndAddSpeakerColumnInEvents1761198193274';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "speaker" character varying NOT NULL DEFAULT 'CARE_GIVER'`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "title" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "scenario" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "description" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "coverImageUrl" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "coverImageUrl" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "description" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "scenario" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ALTER COLUMN "title" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "speaker"`,
    );
  }
}
