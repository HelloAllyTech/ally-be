import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveCodeFromBadge1771243367233 implements MigrationInterface {
  name = 'RemoveCodeFromBadge1771243367233';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_cover_image_library_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "badges" DROP CONSTRAINT "UQ_48fe47e292737e09162b08c4f7c"`,
    );
    await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN "code"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "badges" ADD "code" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "badges" ADD CONSTRAINT "UQ_48fe47e292737e09162b08c4f7c" UNIQUE ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_cover_image_library_created_at" ON "scenario_cover_image_library" ("createdAt") `,
    );
  }
}
