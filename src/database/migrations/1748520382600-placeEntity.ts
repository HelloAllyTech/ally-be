import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlaceEntity1748520382600 implements MigrationInterface {
  name = 'PlaceEntity1748520382600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "places" ("id" SERIAL NOT NULL, "city" character varying NOT NULL, "state" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1afab86e226b4c3bc9a74465c12" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_city" ON "places" ("city") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_city"`);
    await queryRunner.query(`DROP TABLE "places"`);
  }
}
