import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreferenceEntity1747809770500 implements MigrationInterface {
  name = 'PreferenceEntity1747809770500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "preference" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "relatedId" character varying NOT NULL, "relatedEntity" character varying NOT NULL, "value" jsonb NOT NULL, CONSTRAINT "PK_5c4cbf49a1e97dcbc695bf462a6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_preference_related_entity_id" ON "preference" ("relatedId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_preference_related_entity_id"`,
    );
    await queryRunner.query(`DROP TABLE "preference"`);
  }
}
