import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { AGENT_LIMITS } from '../constants/analytics-agent.constants';
import { wrapWithRowCap } from '../util/sql-guard.util';

export interface AgentQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  /** True when the query had more rows than the cap, so any total the answer
   *  states is a lower bound rather than the figure. */
  truncated: boolean;
  durationMs: number;
}

/**
 * Runs one guarded, LLM-authored query inside an envelope the query cannot
 * escape.
 *
 * Three properties, each closing a failure this feature would otherwise have:
 *
 *  - **READ ONLY transaction.** The guard's keyword rules are regexes over
 *    generated text; this is Postgres itself refusing to write. It holds even
 *    for a construct nobody anticipated, and it is the reason a gap in the guard
 *    is a wrong answer rather than a lost table.
 *  - **statement_timeout.** A generated query can accidentally cross-join two
 *    large fact tables. Without a timeout that is not a slow answer, it is a
 *    connection held open against the primary database that also serves live
 *    voice sessions.
 *  - **Row cap, asked for as cap + 1.** The extra row is how "exactly 500 rows"
 *    is told apart from "cut short at 500" — the difference between a total and
 *    a lower bound, which the answer has to state honestly.
 *
 * The transaction is always rolled back. There is nothing to commit, and a
 * rollback makes that explicit rather than incidental.
 */
@Injectable()
export class SqlExecutorService {
  private readonly logger = LoggerService.getInstance(SqlExecutorService.name);

  constructor(private readonly dataSource: DataSource) {}

  async run(sql: string): Promise<AgentQueryResult> {
    const limit = AGENT_LIMITS.ROW_LIMIT;
    const wrapped = wrapWithRowCap(sql, limit);
    const queryRunner = this.dataSource.createQueryRunner();
    const startedAt = Date.now();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      // Order matters: SET TRANSACTION READ ONLY must precede the first query in
      // the transaction. `SET LOCAL` scopes the timeout to this transaction, so
      // the pooled connection returns to the pool with its normal settings.
      await queryRunner.query('SET TRANSACTION READ ONLY');
      await queryRunner.query(
        `SET LOCAL statement_timeout = ${AGENT_LIMITS.STATEMENT_TIMEOUT_MS}`,
      );

      const rows: Record<string, unknown>[] = await queryRunner.query(wrapped);
      const durationMs = Date.now() - startedAt;
      const truncated = rows.length > limit;
      const kept = truncated ? rows.slice(0, limit) : rows;

      this.logger.debug(
        `analytics agent query ran in ${durationMs}ms rows=${kept.length}` +
          (truncated ? ' (truncated)' : ''),
      );

      return {
        // Column order comes from the driver's row objects, which are built in
        // the result's field order — so the table renders in the order the query
        // asked for rather than alphabetically. An empty result has no order to
        // recover, and no table to render either.
        columns: kept.length ? Object.keys(kept[0]) : [],
        rows: kept,
        truncated,
        durationMs,
      };
    } finally {
      // Roll back whether the query succeeded or threw: this transaction exists
      // to bound a read, and committing it would only ever be a mistake.
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction().catch(() => undefined);
      }
      await queryRunner.release().catch(() => undefined);
    }
  }
}
