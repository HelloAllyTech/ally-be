import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganizationIdToReferenceDocuments1749807810359 implements MigrationInterface {
  name = 'AddOrganizationIdToReferenceDocuments1749807810359';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reference_documents" ADD "organizationId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reference_documents" DROP COLUMN "organizationId"`,
    );
  }
}
