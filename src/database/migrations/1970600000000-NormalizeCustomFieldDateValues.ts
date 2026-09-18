import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DATE custom-field values are calendar dates, stored as bare `YYYY-MM-DD`.
 *
 * The web panel used to write `new Date(...).toISOString()`, which for a picker
 * in IST (UTC+5:30) is 18:30 on the *previous* day: picking 22 Aug 2026 stored
 * "2026-08-21T18:30:00.000Z". Web hid the shift by re-rendering in local time,
 * so it looked right there — but the mobile summary prints the stored string
 * verbatim and showed the 21st, and the session-log filter's
 * `CAST(value AS DATE)` matched the 21st too.
 *
 * This rewrites every affected row to the calendar day the user actually
 * picked, resolved in Asia/Kolkata (confirmed org timezone; there is no
 * per-tenant timezone in the data model and every current tenant is in India).
 * Rows already stored date-only — written by mobile, whose editor is a
 * `YYYY-MM-DD` text box — are left untouched by the pattern guard, as is
 * anything else that does not look like an ISO instant.
 */
export class NormalizeCustomFieldDateValues1970600000000 implements MigrationInterface {
  name = 'NormalizeCustomFieldDateValues1970600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "chat_custom_field_values" cfv
      SET "value" = to_char(
        (cfv."value"::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
        'YYYY-MM-DD'
      )
      FROM "custom_field_definitions" d
      WHERE d."id" = cfv."fieldDefinitionId"
        AND d."fieldType" = 'DATE'
        AND cfv."value" ~ '^\\d{4}-\\d{2}-\\d{2}T'
    `);
  }

  public async down(): Promise<void> {
    /*
     * Deliberately a no-op rather than re-encoding the dates as instants.
     *
     * Re-applying `toISOString()` would restore the very off-by-one this
     * migration exists to remove, and it cannot distinguish rows this
     * migration rewrote from rows mobile had always written date-only — so it
     * would corrupt the latter on the way past.
     *
     * Leaving the data normalized is safe on a rollback: the previous web
     * build reads a date-only value through `new Date("2026-08-22")`, which is
     * UTC midnight and still renders as the 22nd anywhere east of UTC.
     */
  }
}
