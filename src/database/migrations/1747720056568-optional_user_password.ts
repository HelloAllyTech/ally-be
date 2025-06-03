import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptionalUserPassword1747720056568 implements MigrationInterface {
  name = 'OptionalUserPassword1747720056568';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL`,
    );
  }
}
