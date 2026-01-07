import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileImageUrlColumn1767691878075
  implements MigrationInterface
{
  name = 'AddProfileImageUrlColumn1767691878075';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "profileImageUrl" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "profileImageUrl"`,
    );
  }
}
