import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a BLANK, INACTIVE placeholder tooltip row for the new admin
 * "Edit Simulation → Basic Settings → Reminders" toggle, following the same
 * convention as SeedBasicSettingsTooltipPlaceholders: a superadmin authors
 * the text and flips `active` on under Manage Tooltips when ready.
 *
 * Keep the slug in sync with the `TooltipLocation` enum in
 * ally-admin-dashboard/src/constants/common.ts.
 */
export class SeedRemindersEnabledTooltipPlaceholder1864000000000 implements MigrationInterface {
  name = 'SeedRemindersEnabledTooltipPlaceholder1864000000000';

  private readonly location = 'reminders_enabled';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "tooltips" ("location", "tipText", "active", "createdBy", "updatedBy")
       VALUES ($1, '', false, 0, 0)
       ON CONFLICT ("location") DO NOTHING`,
      [this.location],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove the row if it's still in its seeded blank+inactive state,
    // so a superadmin's authored/enabled content is never dropped on revert.
    await queryRunner.query(
      `DELETE FROM "tooltips"
       WHERE "location" = $1
         AND "createdBy" = 0 AND "tipText" = '' AND "active" = false`,
      [this.location],
    );
  }
}
