/**
 * Whitelisted sort resolution for the admin list endpoints.
 *
 * The column name reaches an `ORDER BY` clause, so it can NEVER be taken from the request as
 * written — a query-string parameter interpolated into ORDER BY is a SQL injection with extra steps.
 * The caller supplies a map of request-facing keys to real column expressions, and anything not in
 * that map falls back to the list's default rather than erroring: a stale bookmark carrying a sort
 * key that has since been renamed should show the default order, not a 400 on a read-only screen.
 */
export interface SortableColumns {
  [requestKey: string]: string;
}

export interface ResolvedSort {
  column: string;
  direction: 'ASC' | 'DESC';
}

export function resolveSort(
  columns: SortableColumns,
  fallbackColumn: string,
  requested?: string,
  requestedDirection?: string,
  fallbackDirection: 'ASC' | 'DESC' = 'DESC',
): ResolvedSort {
  // hasOwnProperty, not a bare `columns[requested]`: a plain object inherits from Object.prototype,
  // so keys like `toString` and `constructor` return truthy INHERITED members. Those would pass a
  // naive truthiness check and put a Function into the ORDER BY clause. An own-property check is
  // what actually makes this a whitelist.
  const column =
    requested && Object.prototype.hasOwnProperty.call(columns, requested)
      ? columns[requested]
      : fallbackColumn;
  // Anything that is not exactly "asc" is descending. Lists here are activity logs and worklists,
  // where newest-first is the useful default and a typo should not silently invert the page.
  const direction =
    requestedDirection?.toLowerCase() === 'asc'
      ? 'ASC'
      : requestedDirection?.toLowerCase() === 'desc'
        ? 'DESC'
        : fallbackDirection;

  return { column, direction };
}
