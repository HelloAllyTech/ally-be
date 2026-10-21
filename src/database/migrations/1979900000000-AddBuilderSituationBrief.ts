import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_settings.situationBrief`: the switch for Builder's interview protocol (W4).
 *
 * On, a new interview opens with a server discovery sweep — the platform map, docs, wiki and
 * code searched before anything is asked — and its first visible turn is a situation brief the
 * admin confirms or corrects line by line; every later question names its type, its basis and
 * why research cannot settle it. It needs validated turns (it is checked the same way); with
 * those off it does nothing. Defaults on, like validated turns, and is how it is switched back
 * without a deploy.
 */
export class AddBuilderSituationBrief1979900000000 implements MigrationInterface {
  name = 'AddBuilderSituationBrief1979900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "situationBrief" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "situationBrief"`,
    );
  }
}
