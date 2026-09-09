import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import * as isoWeek from 'dayjs/plugin/isoWeek';
import { TIMEZONES } from '../constants/timezone.constants';

// Extend dayjs with UTC, timezone and ISO-week plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

export const convertIstStringToUtc = (dateTimeString: string): Date => {
  return dayjs.tz(dateTimeString, TIMEZONES.IST).utc().toDate();
};

/**
 * The timezone whose calendar day defines a "day" for user-facing daily
 * mechanics (practice streaks, daily scores). IST is deliberate: it has no DST,
 * so day arithmetic stays exact integer arithmetic — a DST-observing zone would
 * produce 23- and 25-hour days that break consecutive-day (gaps-and-islands)
 * detection twice a year.
 */
export const BUSINESS_TIMEZONE = TIMEZONES.IST;

/**
 * Calendar day (YYYY-MM-DD) that `instant` falls on in the business timezone.
 *
 * Returns a string, never a Date, and callers must bind it as `$n::date`. A Date
 * bound through node-postgres is rendered with the *process* timezone
 * (`parseInputDatesAsUTC: false`), so passing one would silently make the day
 * bucket depend on the container's TZ. A plain YYYY-MM-DD string has no timezone
 * semantics at all.
 */
export const toBusinessDateString = (instant: Date = new Date()): string =>
  dayjs(instant).tz(BUSINESS_TIMEZONE).format('YYYY-MM-DD');

/**
 * ISO week (`2026-W37`) that `instant` falls in, in the business timezone.
 *
 * Used as the idempotency key for once-a-week awards. ISO weeks run Monday to Sunday
 * and the ISO week-year is not always the calendar year — 1 Jan 2027 is in 2026-W53 —
 * so the year has to come from `isoWeekYear()`, not `year()`, or the last days of
 * December collide with the first week of the wrong year.
 */
export const toBusinessWeekKey = (instant: Date = new Date()): string => {
  const local = dayjs(instant).tz(BUSINESS_TIMEZONE);
  return `${local.isoWeekYear()}-W${String(local.isoWeek()).padStart(2, '0')}`;
};

/** First and last business dates (YYYY-MM-DD) of the ISO week `instant` falls in. */
export const businessWeekBounds = (
  instant: Date = new Date(),
): { start: string; end: string } => {
  const local = dayjs(instant).tz(BUSINESS_TIMEZONE);
  return {
    start: local.startOf('isoWeek').format('YYYY-MM-DD'),
    end: local.endOf('isoWeek').format('YYYY-MM-DD'),
  };
};

export const addDurationToDate = ({
  date,
  duration,
  unit,
}: {
  date: Date;
  duration: number;
  unit: dayjs.ManipulateType;
}): Date => {
  return dayjs(date).add(duration, unit).toDate();
};

export const subtractDurationFromDate = ({
  date,
  duration,
  unit,
}: {
  date: Date;
  duration: number;
  unit: dayjs.ManipulateType;
}): Date => {
  return dayjs(date).subtract(duration, unit).toDate();
};

export const convertTimestampNsToDate = (timestampNs: bigint): Date => {
  return new Date(Number(timestampNs / 1_000_000n));
};

// Export the configured dayjs instance
export default dayjs;
