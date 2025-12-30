import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateMessageStartAndEndSeconds1751013008623
  implements MigrationInterface
{
  name = 'UpdateMessageStartAndEndSeconds1751013008623';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "endedAt"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "startedAt"`);
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "startSeconds" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "endSeconds" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "endSeconds"`);
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN "startSeconds"`,
    );
    await queryRunner.query(`ALTER TABLE "messages" ADD "startedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "endedAt" TIMESTAMP`);
  }
}
