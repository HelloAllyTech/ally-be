import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoverVideoUrlToScenarios1762260578442 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD COLUMN "coverVideoUrl" VARCHAR NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "coverVideoUrl"`,
    );
  }
}
