import { MigrationInterface, QueryRunner } from 'typeorm';

export class StartedATNullable1739360317560 implements MigrationInterface {
  name = 'StartedATNullable1739360317560';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "startedAt" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "startedAt" SET NOT NULL`,
    );
  }
}
