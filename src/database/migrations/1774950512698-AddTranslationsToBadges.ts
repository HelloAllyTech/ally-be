import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTranslationsToBadges1774950512698 implements MigrationInterface {
  name = 'AddTranslationsToBadges1774950512698';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "badges" ADD "translations" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "badges" DROP COLUMN "translations"`);
  }
}
