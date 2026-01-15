import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantScopedExternalIdUniqueConstraint1756287205870 implements MigrationInterface {
  name = 'AddTenantScopedExternalIdUniqueConstraint1756287205870';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9bd607baf22cb757623c21c7b3" ON "users" ("tenant_id", "externalId") WHERE "externalId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9bd607baf22cb757623c21c7b3"`,
    );
  }
}
