import { MigrationInterface, QueryRunner } from 'typeorm';

export class NewSummaryFormat1741331187952 implements MigrationInterface {
  name = 'NewSummaryFormat1741331187952';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "call_details" DROP COLUMN "tags"`);
    await queryRunner.query(
      `ALTER TABLE "call_details" DROP COLUMN "callQuality"`,
    );
    await queryRunner.query(`ALTER TABLE "call_details" ADD "callInfo" jsonb`);
    await queryRunner.query(`ALTER TABLE "call_details" DROP COLUMN "summary"`);
    await queryRunner.query(`ALTER TABLE "call_details" ADD "summary" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "call_details" DROP COLUMN "summary"`);
    await queryRunner.query(`ALTER TABLE "call_details" ADD "summary" text`);
    await queryRunner.query(
      `ALTER TABLE "call_details" DROP COLUMN "callInfo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_details" ADD "callQuality" double precision`,
    );
    await queryRunner.query(`ALTER TABLE "call_details" ADD "tags" text`);
  }
}
