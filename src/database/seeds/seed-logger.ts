/**
 * Seed Logger Utility
 *
 * Provides consistent logging across all seed operations.
 * Supports different log levels and formats.
 */

import { logStep } from './seed-utils';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  seedName: string;
  message: string;
  details?: any;
}

export class SeedLogger {
  private seedName: string;
  private verbose: boolean;
  private logs: LogEntry[] = [];

  constructor(seedName: string, verbose: boolean = false) {
    this.seedName = seedName;
    this.verbose = verbose;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: LogLevel, message: string): string {
    const prefix = `[${this.seedName}]`;

    switch (level) {
      case LogLevel.SUCCESS:
        return `✅ ${prefix} ${message}`;
      case LogLevel.ERROR:
        return `❌ ${prefix} ${message}`;
      case LogLevel.WARNING:
        return `⚠️  ${prefix} ${message}`;
      case LogLevel.INFO:
        return `ℹ️  ${prefix} ${message}`;
      case LogLevel.DEBUG:
        return `🔧 ${prefix} ${message}`;
      default:
        return `${prefix} ${message}`;
    }
  }

  private addLog(level: LogLevel, message: string, details?: any): void {
    this.logs.push({
      timestamp: this.formatTimestamp(),
      level,
      seedName: this.seedName,
      message,
      details,
    });
  }

  debug(message: string, details?: any): void {
    if (this.verbose) {
      logStep(this.formatMessage(LogLevel.DEBUG, message));
    }
    this.addLog(LogLevel.DEBUG, message, details);
  }

  info(message: string, details?: any): void {
    logStep(this.formatMessage(LogLevel.INFO, message));
    this.addLog(LogLevel.INFO, message, details);
  }

  success(message: string, details?: any): void {
    logStep(this.formatMessage(LogLevel.SUCCESS, message));
    this.addLog(LogLevel.SUCCESS, message, details);
  }

  warning(message: string, details?: any): void {
    logStep(this.formatMessage(LogLevel.WARNING, message));
    this.addLog(LogLevel.WARNING, message, details);
  }

  error(message: string, details?: any): void {
    logStep(this.formatMessage(LogLevel.ERROR, message));
    this.addLog(LogLevel.ERROR, message, details);
  }

  section(title: string): void {
    const line = '─'.repeat(60);
    logStep(`\n${line}`);
    logStep(`  ${title}`);
    logStep(`${line}\n`);
  }

  table(data: Record<string, any>[]): void {
    if (data.length === 0) {
      logStep('  (no data)');
      return;
    }

    const keys = Object.keys(data[0]);
    const columns = keys.map((k) => ({
      key: k,
      width: Math.max(k.length, ...data.map((d) => String(d[k] || '').length)),
    }));

    // Print header
    let header = '  ';
    columns.forEach((col) => {
      header += col.key.padEnd(col.width + 2);
    });
    logStep(header);

    // Print separator
    let separator = '  ';
    columns.forEach((col) => {
      separator += '─'.repeat(col.width + 2);
    });
    logStep(separator);

    // Print rows
    data.forEach((row) => {
      let line = '  ';
      columns.forEach((col) => {
        const value = String(row[col.key] || '').padEnd(col.width);
        line += value + '  ';
      });
      logStep(line);
    });
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  getSummary(): {
    total: number;
    byLevel: Record<LogLevel, number>;
  } {
    const byLevel: Record<LogLevel, number> = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 0,
      [LogLevel.SUCCESS]: 0,
      [LogLevel.WARNING]: 0,
      [LogLevel.ERROR]: 0,
    };

    this.logs.forEach((log) => {
      byLevel[log.level]++;
    });

    return {
      total: this.logs.length,
      byLevel,
    };
  }
}

/**
 * Global seed logger instance
 */
let globalLogger: SeedLogger | null = null;

export function initGlobalLogger(
  seedName: string,
  verbose: boolean = false,
): SeedLogger {
  globalLogger = new SeedLogger(seedName, verbose);
  return globalLogger;
}

export function getGlobalLogger(): SeedLogger {
  if (!globalLogger) {
    globalLogger = new SeedLogger('GLOBAL', false);
  }
  return globalLogger;
}

/**
 * Formatted output for reports
 */
export function printSummaryReport(
  seedName: string,
  results: {
    created: number;
    updated: number;
    failed: number;
    skipped?: number;
  },
): void {
  const logger = getGlobalLogger();

  logStep('\n' + '─'.repeat(60));
  logStep(`  ${seedName} Summary`);
  logStep('─'.repeat(60));

  const data = [];
  if (results.created > 0)
    data.push({ Label: 'Created', Count: results.created });
  if (results.updated > 0)
    data.push({ Label: 'Updated', Count: results.updated });
  if (results.skipped && results.skipped > 0)
    data.push({ Label: 'Skipped', Count: results.skipped });
  if (results.failed > 0) data.push({ Label: 'Failed', Count: results.failed });

  logger.table(data);
  logStep('');
}
