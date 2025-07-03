import { MigrationInterface, QueryRunner } from 'typeorm';

export class CallQuality1741168017895 implements MigrationInterface {
  name = 'CallQuality1741168017895';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "call_details" ADD "callQuality" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "call_details" DROP COLUMN "callQuality"`,
    );
  }
}
