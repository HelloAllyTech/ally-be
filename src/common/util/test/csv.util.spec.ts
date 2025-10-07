import { parseCsvBuffer, ParsedCsvRow } from '../csv.util';

// Mock csv-parse/sync
jest.mock('csv-parse/sync', () => ({
  parse: jest.fn(),
}));

describe('CsvUtil', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parse: mockParse } = require('csv-parse/sync');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseCsvBuffer', () => {
    it('should throw error when CSV parsing fails', () => {
      const buffer = Buffer.from('invalid,csv,data');
      const parseError = new Error('Invalid CSV format');
      mockParse.mockImplementation(() => {
        throw parseError;
      });

      expect(() => parseCsvBuffer(buffer)).toThrow(
        'Failed to parse CSV: Invalid CSV format',
      );
      expect(mockParse).toHaveBeenCalledWith('invalid,csv,data', {
        columns: true,
        skipEmptyLines: true,
        trim: true,
      });
    });

    it('should parse CSV buffer successfully with default options', () => {
      const buffer = Buffer.from('name,age\nJohn,30\nJane,25');
      const expectedResult: ParsedCsvRow[] = [
        { name: 'John', age: '30' },
        { name: 'Jane', age: '25' },
      ];
      mockParse.mockReturnValue(expectedResult);

      const result = parseCsvBuffer(buffer);

      expect(mockParse).toHaveBeenCalledWith('name,age\nJohn,30\nJane,25', {
        columns: true,
        skipEmptyLines: true,
        trim: true,
      });
      expect(result).toEqual(expectedResult);
    });

    it('should parse CSV buffer with custom options', () => {
      const buffer = Buffer.from('name,age\nJohn,30\nJane,25');
      const expectedResult: ParsedCsvRow[] = [
        { name: 'John', age: '30' },
        { name: 'Jane', age: '25' },
      ];
      const customOptions = {
        columns: false,
        skipEmptyLines: false,
        trim: false,
      };
      mockParse.mockReturnValue(expectedResult);

      const result = parseCsvBuffer(buffer, customOptions);

      expect(mockParse).toHaveBeenCalledWith(
        'name,age\nJohn,30\nJane,25',
        customOptions,
      );
      expect(result).toEqual(expectedResult);
    });
  });
});
