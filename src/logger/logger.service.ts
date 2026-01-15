import winston, { createLogger, format, transports } from 'winston';
import { ExecutionManager } from '../common/execution/execution-manager';

export class LoggerService {
  private readonly winstonLogger: winston.Logger;
  private context: string;
  private static instance: LoggerService;

  constructor(context: string) {
    this.winstonLogger = LoggerService.createWinstonLogger();
    this.context = context;
  }

  public static getInstance(context: string): LoggerService {
    LoggerService.instance = new LoggerService(context);
    return LoggerService.instance;
  }

  private static createWinstonLogger() {
    const envLevel = (process.env.LOG_LEVEL || '').toLowerCase();
    const normalizedLevel = ['error', 'warn', 'info', 'debug'].includes(
      envLevel,
    )
      ? envLevel
      : process.env.NODE_ENV === 'production'
        ? 'warn'
        : 'debug';
    const logFormat = format.printf(
      (info) => `${info.level}: [${info.timestamp}]${info.message}`,
    );
    const transportList = [
      new transports.Console({
        level: normalizedLevel,
        format: format.combine(
          format.timestamp(),
          format.colorize(),
          logFormat,
        ),
      }),
    ];
    return createLogger({
      level: normalizedLevel,
      transports: transportList,
      exitOnError: false,
    });
  }

  private createLog(level: string, message: any, error?: unknown) {
    const moduleName = this.context;
    let messageString = message;

    if (typeof message === 'object' && message !== null) {
      messageString = JSON.stringify(message, null, 2);
    }

    let logMessage = `[${moduleName}] ${messageString}`;

    const executionId = ExecutionManager.getExecutionId();
    if (executionId) {
      logMessage = `[${executionId}] ${logMessage}`;
    }

    if (error) {
      const errorObject =
        error instanceof Error ? error : new Error(String(error));
      logMessage += `\nError: ${errorObject.message}`;
      if (errorObject.stack) {
        logMessage += `\nStack: ${errorObject.stack}`;
      }
    }

    this.winstonLogger.log(level, logMessage);
  }

  /**
   * Methods for logging using the LoggerService instance.
   * Following methods are available:
   * debug, info, error, warn
   *
   * @param message The message that needs to be logged
   * @param error Optional error object that will be automatically converted to Error type if needed
   */
  debug(message: any): void {
    this.createLog('debug', message);
  }

  info(message: any): void {
    this.createLog('info', message);
  }

  error(message: any, error?: unknown): void {
    this.createLog('error', message, error);
  }

  warn(message: any, error?: unknown): void {
    this.createLog('warn', message, error);
  }
}
