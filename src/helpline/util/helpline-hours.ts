import { HelplineHours } from '../type/helpline.types';

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Throws RangeError for an unknown IANA zone. */
export function assertTimeZone(tz: string): void {
  new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
}

/** Day of week (0 = Sunday) and HH:MM of `now` in `tz`. */
export function localDayAndTime(
  now: Date,
  tz: string,
): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: WEEKDAY[get('weekday')] ?? 0,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/**
 * `hours: null` means "open whenever a listener is Available" (contract §8).
 * Otherwise open iff some entry for today's local weekday has
 * `open <= now < close`. Overnight hours are two entries, one per day.
 * An unknown zone fails open to "within hours" — the listener-availability
 * check still applies, and refusing every talker over a typo is worse.
 */
export function isWithinHours(hours: HelplineHours | null, now: Date): boolean {
  if (!hours || !hours.weekly?.length) return true;
  let local: { day: number; time: string };
  try {
    local = localDayAndTime(now, hours.tz);
  } catch {
    return true;
  }
  return hours.weekly.some(
    (entry) =>
      entry.day === local.day &&
      entry.open <= local.time &&
      local.time < entry.close,
  );
}
