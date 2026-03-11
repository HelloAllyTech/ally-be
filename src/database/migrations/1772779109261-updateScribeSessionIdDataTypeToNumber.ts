import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateScribeSessionIdDataTypeToNumber1772779109261 implements MigrationInterface {
  name = 'UpdateScribeSessionIdDataTypeToNumber1772779109261';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scribe_session_reviews" DROP COLUMN "scribeSessionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scribe_session_reviews" ADD "scribeSessionId" integer NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scribe_session_reviews" DROP COLUMN "scribeSessionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scribe_session_reviews" ADD "scribeSessionId" uuid NOT NULL`,
    );
  }
}
