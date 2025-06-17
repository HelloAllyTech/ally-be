import { parse } from 'csv-parse/sync';

export interface ParsedCsvRow {
  [key: string]: string;
}

export function parseCsvBuffer(
  buffer: Buffer,
  options: {
    columns?: boolean;
    skipEmptyLines?: boolean;
    trim?: boolean;
  } = {
    columns: true,
    skipEmptyLines: true,
    trim: true,
  },
): ParsedCsvRow[] {
  try {
    const csvText = buffer.toString('utf-8');
    return parse(csvText, options);
  } catch (err: any) {
    throw new Error('Failed to parse CSV: ' + err.message);
  }
}
