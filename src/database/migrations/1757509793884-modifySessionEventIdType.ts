import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModifySessionEventIdType1757509793884 implements MigrationInterface {
  name = 'ModifySessionEventIdType1757509793884';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP CONSTRAINT "PK_aeae988940cef0a489a14200af3"`,
    );
    await queryRunner.query(`ALTER TABLE "session_events" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "id" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD CONSTRAINT "PK_aeae988940cef0a489a14200af3" PRIMARY KEY ("id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP CONSTRAINT "PK_aeae988940cef0a489a14200af3"`,
    );
    await queryRunner.query(`ALTER TABLE "session_events" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "id" SERIAL NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD CONSTRAINT "PK_aeae988940cef0a489a14200af3" PRIMARY KEY ("id")`,
    );
  }
}
