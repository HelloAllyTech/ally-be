import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReferenceDocuments1749623858389 implements MigrationInterface {
  name = 'AddReferenceDocuments1749623858389';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reference_documents" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "heading" character varying NOT NULL, "content" character varying NOT NULL, "category" character varying NOT NULL, "tags" text array, "createdBy" integer NOT NULL, "isPublic" boolean NOT NULL DEFAULT false, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP, "uploadStatus" character varying NOT NULL, CONSTRAINT "PK_f3d000718b5d82af42cc1f0bed4" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "reference_documents"`);
  }
}
