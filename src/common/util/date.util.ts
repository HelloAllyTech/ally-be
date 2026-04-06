import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import { TIMEZONES } from '../constants/timezone.constants';

// Extend dayjs with UTC and timezone plugins
dayjs.extend(utc);
dayjs.extend(timezone);

export const convertIstStringToUtc = (dateTimeString: string): Date => {
  return dayjs.tz(dateTimeString, TIMEZONES.IST).utc().toDate();
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
