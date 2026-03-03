import { MigrationInterface, QueryRunner } from 'typeorm';

export class updateLanguageCodeEnGB1772513245331 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "languages" SET "value" = 'en-GB' WHERE "value" = 'en-GLOBAL'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "languages" SET "value" = 'en-GLOBAL' WHERE "value" = 'en-GB'`,
    );
  }
}
