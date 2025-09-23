import { Logger, QueryRunner } from 'typeorm';
import { LoggerService } from '../logger/logger.service';

export class DBLogger implements Logger {
  private readonly logger = LoggerService.getInstance(DBLogger.name);
  logQuery(query: string, parameters?: any[], queryRunner?: QueryRunner) {
    this.logger.debug(`QUERY: ${query}`);
    if (parameters && parameters.length > 0) {
      this.logger.debug(`PARAMETERS: ${JSON.stringify(parameters)}`);
    }
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: any[],
    queryRunner?: QueryRunner,
  ) {
    // check if tenantId where clause is present only after where since get can contain tenantId
    if (query.includes('where')) {
      const whereIndex = query.indexOf('where');
      const tenantIdIndex = query.indexOf('tenantId');
      if (tenantIdIndex > whereIndex) {
        this.logger.error(`QUERY ERROR: ${query}`);
      }
    }
  }

  logQuerySlow(
    time: number,
    query: string,
    parameters?: any[],
    queryRunner?: QueryRunner,
  ) {
    this.logger.warn(`SLOW QUERY: ${time}ms | ${query}`);
  }

  logSchemaBuild(message: string, queryRunner?: QueryRunner) {}

  logMigration(message: string, queryRunner?: QueryRunner) {}

  log(
    level: 'log' | 'info' | 'warn',
    message: any,
    queryRunner?: QueryRunner,
  ) {}
}
