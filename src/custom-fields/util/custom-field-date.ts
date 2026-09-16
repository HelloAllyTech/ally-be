/**
 * Storage rules for DATE custom-field values.
 *
 * A DATE custom field holds a *calendar date* — the day a session happened —
 * so it is stored as a bare `YYYY-MM-DD` string with no time and no timezone.
 * Every consumer then reads back the day the user picked: the web panel, the
 * mobile summary (which prints the stored string verbatim), and the SQL
 * filters below.
 *
 * Historically web stored `new Date(...).toISOString()`. For a picker in IST
 * (UTC+5:30) that is 18:30 on the *previous* day — 22 Aug became
 * "2026-08-21T18:30:00.000Z" — which web hid by re-rendering in local time
 * while mobile and `CAST(value AS DATE)` both showed the 21st.
 */

/**
 * Timezone in which a legacy instant is resolved back to the calendar day the
 * user originally picked. There is no per-tenant timezone in the data model
 * and every current tenant is in India; this is used only for values written
 * before the `NormalizeCustomFieldDateValues` migration, and for filter bounds
 * still sent as instants by the shared table date-picker.
 */
export const ORG_CALENDAR_TIMEZONE = 'Asia/Kolkata';

/** A bare calendar date with no time part, e.g. "2026-08-22". */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `en-CA` formats as `YYYY-MM-DD`, which is exactly the storage shape, so this
 * resolves an instant to a calendar date in the org timezone without manual
 * offset arithmetic.
 */
const orgDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORG_CALENDAR_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Normalize any DATE value or filter bound to `YYYY-MM-DD`. Date-only strings
 * pass through untouched; full instants are resolved in the org timezone.
 * Returns null for absent or unparseable input, so callers can drop the clause
 * rather than cast garbage.
 */
export function toOrgCalendarDate(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return orgDateFormatter.format(parsed);
}

/**
 * SQL that yields the calendar date held by `column`, tolerating both storage
 * shapes so filtering stays correct while a stale client is still writing
 * instants. Values matching neither shape (the mobile editor is a free-text
 * box) become NULL rather than raising a cast error, which a bare
 * `CAST(value AS DATE)` would do — one malformed row failing the whole
 * session-log query.
 */
export function orgCalendarDateSql(column: string): string {
  return `CASE
    WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${column}::date
    WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (${column}::timestamptz AT TIME ZONE '${ORG_CALENDAR_TIMEZONE}')::date
    ELSE NULL
  END`;
}
