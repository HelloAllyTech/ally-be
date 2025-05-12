import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexOntenantId1747028015636 implements MigrationInterface {
  name = 'AddIndexOntenantId1747028015636';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_groups" ALTER COLUMN "tenant_id" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_groups" ALTER COLUMN "tenant_id" SET DEFAULT 'default'`,
    );
  }
}
