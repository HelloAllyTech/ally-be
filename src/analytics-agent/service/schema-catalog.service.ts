import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import {
  ALLOWED_TABLES,
  DENIED_COLUMNS,
  DENIED_COLUMN_PATTERNS,
} from '../constants/analytics-agent.constants';

export interface CatalogColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface CatalogTable {
  name: string;
  purpose: string;
  columns: CatalogColumn[];
}

/**
 * Builds the schema catalogue the planner writes SQL against.
 *
 * Columns are **introspected from the live database**, not hand-listed. This
 * repo's column naming is genuinely mixed — most columns are snake_case, but
 * several entities keep camelCase columns (`promptTokens`, `compositeScore`,
 * `occurredAt`) — so a hand-maintained catalogue would be wrong for exactly the
 * tables people ask the most questions about, and wrong in the way that is
 * hardest to notice: the planner would emit a column that does not exist, and
 * the reader would see a database error instead of an answer.
 *
 * Introspection also means the catalogue cannot drift. A migration that renames
 * a column changes what the agent is told on the next cache refresh, with no
 * second place to update.
 *
 * The result is cached in memory: the schema changes on deploy, not per request,
 * and this query touches every allowlisted table's metadata.
 */
@Injectable()
export class SchemaCatalogService {
  private readonly logger = LoggerService.getInstance(
    SchemaCatalogService.name,
  );

  /** Long enough that a burst of questions costs one introspection, short
   *  enough that a migration is picked up without a restart. */
  private static readonly CACHE_TTL_MS = 15 * 60 * 1000;

  private cache: { tables: CatalogTable[]; renderedAt: number } | null = null;

  constructor(private readonly dataSource: DataSource) {}

  /** Whether a column may be exposed to the agent at all. Applied here as well
   *  as in the SQL guard: the guard stops a denied column being *used*, this
   *  stops it being *suggested*, and a column the planner never sees is a query
   *  it never has to have rejected. */
  static isColumnReadable(name: string): boolean {
    const lowered = name.toLowerCase();
    if (DENIED_COLUMNS.includes(lowered)) return false;
    return !DENIED_COLUMN_PATTERNS.some((pattern) => pattern.test(lowered));
  }

  async getCatalog(): Promise<CatalogTable[]> {
    if (
      this.cache &&
      Date.now() - this.cache.renderedAt < SchemaCatalogService.CACHE_TTL_MS
    ) {
      return this.cache.tables;
    }
    const tables = await this.introspect();
    this.cache = { tables, renderedAt: Date.now() };
    return tables;
  }

  private async introspect(): Promise<CatalogTable[]> {
    const names = Object.keys(ALLOWED_TABLES);
    // Parameterised against the allowlist — the only user input anywhere near
    // this query is absent by construction.
    const rows: {
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }[] = await this.dataSource.query(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position`,
      [names],
    );

    const byTable = new Map<string, CatalogColumn[]>();
    for (const row of rows) {
      if (!SchemaCatalogService.isColumnReadable(row.column_name)) continue;
      const columns = byTable.get(row.table_name) ?? [];
      columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
      });
      byTable.set(row.table_name, columns);
    }

    const missing = names.filter((name) => !byTable.has(name));
    if (missing.length) {
      // An allowlisted table that does not exist is a stale allowlist, not a
      // reason to fail the request: the agent simply is not told about it.
      this.logger.warn(
        `analytics agent catalogue: allowlisted tables not found in the database: ${missing.join(', ')}`,
      );
    }

    return names
      .filter((name) => byTable.has(name))
      .map((name) => ({
        name,
        purpose: ALLOWED_TABLES[name],
        columns: byTable.get(name) ?? [],
      }));
  }

  /**
   * Render the catalogue for the planner prompt.
   *
   * One line per table, columns inline with their types. Compact on purpose: the
   * whole catalogue travels on every planning call, and a format that spends
   * three lines per column would push the tables that matter out of the model's
   * attention long before it ran out of context.
   */
  async render(): Promise<string> {
    const tables = await this.getCatalog();
    const lines = tables.map((table) => {
      const columns = table.columns
        .map(
          (column) =>
            `${column.name} ${column.type}${column.nullable ? '' : ' NOT NULL'}`,
        )
        .join(', ');
      return `TABLE ${table.name} — ${table.purpose}\n  COLUMNS: ${columns}`;
    });
    return [
      'Columns not listed for a table do not exist or are not readable. Some',
      'columns are camelCase and must be double-quoted in SQL (e.g. "occurredAt");',
      'snake_case columns need no quoting.',
      '',
      ...lines,
    ].join('\n');
  }

  /** Drop the cached catalogue (used by the tests and after a schema change). */
  invalidate(): void {
    this.cache = null;
  }
}
