import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateScenarioTranslations1774435332926 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scenarios s
      SET translations = sub.translations
      FROM (
        SELECT 
          st."scenarioId",
          jsonb_object_agg(
            l."translationCode",
            jsonb_build_object(
              'title', st.metadata->>'title',
              'description', st.metadata->>'description'
            )
          ) AS translations
        FROM scenario_translations st
        JOIN languages l 
          ON l.id = st."languageId"
        GROUP BY st."scenarioId"
      ) sub
      WHERE s.id = sub."scenarioId"
        AND sub.translations IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scenarios s
      SET translations = NULL
      WHERE EXISTS (
        SELECT 1
        FROM scenario_translations st
        WHERE st."scenarioId" = s.id
      );
    `);
  }
}
