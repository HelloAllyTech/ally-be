import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueueEntryTenantId1746769599058 implements MigrationInterface {
  name = 'QueueEntryTenantId1746769599058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "queue_entries" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_entries" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_entries" ADD "tenant_id" character varying NOT NULL DEFAULT 'default'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "queue_entries" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_entries" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_entries" DROP COLUMN "createdAt"`,
    );
  }
}
