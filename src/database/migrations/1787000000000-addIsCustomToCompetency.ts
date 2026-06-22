import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsCustomToCompetency1787000000000 implements MigrationInterface {
  name = 'AddIsCustomToCompetency1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "competencies" ADD COLUMN "isCustom" boolean NOT NULL DEFAULT false`,
    );
    // Custom competencies are auto-named `{createdBy}_custom_{N}` from a
    // read-then-increment, which can race. A partial unique index makes a
    // colliding name a hard error (the service retries) instead of a silent
    // duplicate. Scoped to custom rows so global competencies are unaffected.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_competencies_custom_owner_name" ON "competencies" ("createdBy", "name") WHERE "isCustom" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_competencies_custom_owner_name"`);
    await queryRunner.query(
      `ALTER TABLE "competencies" DROP COLUMN "isCustom"`,
    );
  }
}
