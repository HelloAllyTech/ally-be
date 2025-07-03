import { Logger, QueryRunner } from 'typeorm';

export class DBLogger implements Logger {
  logQuery(query: string, parameters?: any[], queryRunner?: QueryRunner) {
    console.log('QUERY:', query);
    console.log('PARAMETERS:', parameters);
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
        console.log('QUERY:', query);
      }
    }
  }

  logQuerySlow(
    time: number,
    query: string,
    parameters?: any[],
    queryRunner?: QueryRunner,
  ) {
    console.warn('SLOW QUERY:', time, query);
  }

  logSchemaBuild(message: string, queryRunner?: QueryRunner) {
    // console.log('SCHEMA BUILD:', message);
  }

  logMigration(message: string, queryRunner?: QueryRunner) {
    // console.log('MIGRATION:', message);
  }

  log(level: 'log' | 'info' | 'warn', message: any, queryRunner?: QueryRunner) {
    //console[level](message);
  }
}
