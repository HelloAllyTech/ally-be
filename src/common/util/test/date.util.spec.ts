import * as dayjs from 'dayjs';
import {
  convertIstStringToUtc,
  addDurationToDate,
  subtractDurationFromDate,
} from '../date.util';
import { TIMEZONES } from '../../constants/timezone.constants';

// Mock dayjs
jest.mock('dayjs', () => {
  const mockChain = {
    tz: jest.fn().mockReturnThis(),
    utc: jest.fn().mockReturnThis(),
    add: jest.fn().mockReturnThis(),
    subtract: jest.fn().mockReturnThis(),
    toDate: jest.fn(),
  };

  const mockDayjs = jest.fn(() => mockChain) as any;
  mockDayjs.extend = jest.fn();
  mockDayjs.tz = jest.fn().mockReturnValue(mockChain);

  return mockDayjs;
});

describe('DateUtil', () => {
  let mockDayjs: any;
  let mockChain: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDayjs = require('dayjs');
    mockChain = mockDayjs();
  });

  describe('convertIstStringToUtc', () => {
    it('should convert IST string to UTC date', () => {
      const dateTimeString = '2024-01-01 10:00:00';
      const mockDate = new Date('2024-01-01T04:30:00.000Z');
      mockChain.toDate.mockReturnValue(mockDate);

      const result = convertIstStringToUtc(dateTimeString);

      expect(mockDayjs.tz).toHaveBeenCalledWith(dateTimeString, TIMEZONES.IST);
      expect(mockChain.utc).toHaveBeenCalled();
      expect(mockChain.toDate).toHaveBeenCalled();
      expect(result).toBe(mockDate);
    });
  });

  describe('addDurationToDate', () => {
    it('should add duration to date', () => {
      const date = new Date('2024-01-01T10:00:00.000Z');
      const duration = 2;
      const unit = 'hours' as dayjs.ManipulateType;
      const mockDate = new Date('2024-01-01T12:00:00.000Z');
      mockChain.toDate.mockReturnValue(mockDate);

      const result = addDurationToDate({ date, duration, unit });

      expect(mockDayjs).toHaveBeenCalledWith(date);
      expect(mockChain.add).toHaveBeenCalledWith(duration, unit);
      expect(mockChain.toDate).toHaveBeenCalled();
      expect(result).toBe(mockDate);
    });
  });

  describe('subtractDurationFromDate', () => {
    it('should subtract duration from date', () => {
      const date = new Date('2024-01-01T10:00:00.000Z');
      const duration = 1;
      const unit = 'day' as dayjs.ManipulateType;
      const mockDate = new Date('2023-12-31T10:00:00.000Z');
      mockChain.toDate.mockReturnValue(mockDate);

      const result = subtractDurationFromDate({ date, duration, unit });

      expect(mockDayjs).toHaveBeenCalledWith(date);
      expect(mockChain.subtract).toHaveBeenCalledWith(duration, unit);
      expect(mockChain.toDate).toHaveBeenCalled();
      expect(result).toBe(mockDate);
    });
  });
});
