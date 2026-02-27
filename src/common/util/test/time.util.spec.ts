import { parseTimeToSeconds, isValidTimeFormatHHMMSS } from '../time.util';

describe('TimeUtil', () => {
  describe('isValidTimeFormatHHMMSS', () => {
    it('should return true for valid time formats', () => {
      expect(isValidTimeFormatHHMMSS('00:00:00')).toBe(true);
      expect(isValidTimeFormatHHMMSS('00:05:00')).toBe(true);
      expect(isValidTimeFormatHHMMSS('01:30:00')).toBe(true);
      expect(isValidTimeFormatHHMMSS('02:00:00')).toBe(true);
      expect(isValidTimeFormatHHMMSS('12:34:56')).toBe(true);
      expect(isValidTimeFormatHHMMSS('23:59:59')).toBe(true);
      expect(isValidTimeFormatHHMMSS('09:05:30')).toBe(true);
    });

    it('should return false for invalid time formats', () => {
      expect(isValidTimeFormatHHMMSS('')).toBe(false);
      expect(isValidTimeFormatHHMMSS('123')).toBe(false);
      expect(isValidTimeFormatHHMMSS('12:34')).toBe(false);
      expect(isValidTimeFormatHHMMSS('12:34:56:78')).toBe(false);
      expect(isValidTimeFormatHHMMSS('24:00:00')).toBe(false);
      expect(isValidTimeFormatHHMMSS('23:60:00')).toBe(false);
      expect(isValidTimeFormatHHMMSS('23:59:60')).toBe(false);
      expect(isValidTimeFormatHHMMSS('25:00:00')).toBe(false);
      expect(isValidTimeFormatHHMMSS('12:99:00')).toBe(false);
      expect(isValidTimeFormatHHMMSS('abc:def:ghi')).toBe(false);
      expect(isValidTimeFormatHHMMSS('1:2:3')).toBe(false);
    });
  });

  describe('parseTimeToSeconds', () => {
    it('should parse valid time strings to seconds correctly', () => {
      expect(parseTimeToSeconds('00:00:00')).toBe(0);
      expect(parseTimeToSeconds('00:00:01')).toBe(1);
      expect(parseTimeToSeconds('00:01:00')).toBe(60);
      expect(parseTimeToSeconds('00:05:00')).toBe(300);
      expect(parseTimeToSeconds('01:00:00')).toBe(3600);
      expect(parseTimeToSeconds('01:30:00')).toBe(5400);
      expect(parseTimeToSeconds('02:00:00')).toBe(7200);
      expect(parseTimeToSeconds('12:34:56')).toBe(45296);
      expect(parseTimeToSeconds('23:59:59')).toBe(86399);
    });

    it('should throw error for invalid time formats', () => {
      expect(() => parseTimeToSeconds('')).toThrow(
        'Invalid time format. Expected HH:MM:SS, got: ',
      );
      expect(() => parseTimeToSeconds('123')).toThrow(
        'Invalid time format. Expected HH:MM:SS, got: 123',
      );
      expect(() => parseTimeToSeconds('12:34')).toThrow(
        'Invalid time format. Expected HH:MM:SS, got: 12:34',
      );
      expect(() => parseTimeToSeconds('24:00:00')).toThrow(
        'Invalid time format. Expected HH:MM:SS, got: 24:00:00',
      );
      expect(() => parseTimeToSeconds('23:60:00')).toThrow(
        'Invalid time format. Expected HH:MM:SS, got: 23:60:00',
      );
      expect(() => parseTimeToSeconds('abc:def:ghi')).toThrow(
        'Invalid time format. Expected HH:MM:SS, got: abc:def:ghi',
      );
    });
  });
});
