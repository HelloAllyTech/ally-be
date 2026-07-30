import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropIconFromTooltips1872000000000 implements MigrationInterface {
  name = 'DropIconFromTooltips1872000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tooltips" DROP COLUMN "icon"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tooltips" ADD "icon" text`);
  }
}
