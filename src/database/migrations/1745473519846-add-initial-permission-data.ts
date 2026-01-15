import { MigrationInterface, QueryRunner } from 'typeorm';

const PERMISSIONS = {
  ViewNavBarCalls: 'view:navbar:calls',
  ViewNavBarCalendar: 'view:navbar:calendar',
  ViewNavBarAnalytics: 'view:navbar:analytics',
  ViewNavBarStressBuster: 'view:navbar:stress-buster',
  ViewNavBarSettings: 'view:navbar:settings',
  ViewNavBarSearch: 'view:navbar:search',
  ViewNavBarCommunity: 'view:navbar:community',

  EditSummary: 'edit:summary',

  ButtonStartCall: 'view:button:start-call',
  ViewNavBarLearn: 'view:navbar:learn',
};
export class AddInitialPermissionData1745473519846 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of Object.values(PERMISSIONS)) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name") VALUES ($1)`,
        [permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of Object.values(PERMISSIONS)) {
      await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = $1`, [
        permission,
      ]);
    }
  }
}
