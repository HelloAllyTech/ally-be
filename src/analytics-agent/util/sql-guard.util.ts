import {
  AGENT_LIMITS,
  ALLOWED_TABLES,
  DENIED_COLUMNS,
  DENIED_COLUMN_PATTERNS,
  FORBIDDEN_SQL_FRAGMENTS,
  FORBIDDEN_SQL_TOKENS,
} from '../constants/analytics-agent.constants';

/**
 * Static validation of LLM-authored SQL before it reaches the database.
 *
 * This is a *gate*, not a repair shop: a query that breaks a rule is rejected
 * with a reason the reader sees, never rewritten into something safe. Rewriting
 * would mean the SQL shown next to the answer is not the SQL that produced it,
 * which defeats the point of showing it.
 *
 * The guard is one of three layers and is not trusted alone — the executor also
 * runs every query inside a READ ONLY transaction with a statement timeout and
 * an outer row cap, so a parsing gap here still cannot write, hang or dump the
 * database. What the guard adds is *intent*: it can say "the agent tried to read
 * message content" where Postgres would only say "permission denied", and it
 * keeps the denied-column policy enforceable even though the database user can
 * read those columns.
 *
 * Deliberately not a full SQL parser. A parser would let the guard reason about
 * which identifier is a column of which table; it would also be a large
 * dependency whose disagreements with Postgres's own grammar are exactly the
 * kind of gap this file exists to close. The rules below are all conservative:
 * they reject things a legitimate analytics query would not contain.
 */

/** Functions usable in a FROM clause. Both are needed for honest time series:
 *  generate_series to emit a row for a period that had no observations rather
 *  than silently dropping it, unnest to expand an array column. */
const ALLOWED_TABLE_FUNCTIONS: readonly string[] = [
  'generate_series',
  'unnest',
];

export type SqlGuardResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

/** Identifier characters Postgres allows (plus `$`, which it permits after the
 *  first character). */
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_$]*/g;

/**
 * Replace single-quoted string literals with empty ones, so words inside data
 * never trip a keyword rule. Without this, `WHERE status = 'CREATED'` would read
 * as an attempt to CREATE, and the agent would be unusable on enum columns.
 *
 * Doubled quotes ('' — an escaped quote inside a literal) are consumed as part
 * of the literal, so a literal containing a quote cannot end it early and leave
 * SQL text looking like data.
 */
export const stripStringLiterals = (sql: string): string =>
  sql.replace(/'(?:[^']|'')*'/g, "''");

/**
 * Lowercased identifiers appearing in the query, with string literals removed.
 * Double-quoted identifiers (needed for this schema's camelCase columns, e.g.
 * "compositeScore") are included: they are identifiers, so the denied-column
 * policy has to see inside them, or quoting would be a way around it.
 */
export const extractIdentifiers = (sql: string): string[] => {
  const withoutLiterals = stripStringLiterals(sql).replace(/"/g, ' ');
  return (withoutLiterals.match(IDENTIFIER_RE) ?? []).map((id) =>
    id.toLowerCase(),
  );
};

/**
 * Names declared by CTEs in this query, which are legal FROM targets even
 * though they are not tables. Matches `WITH name AS (`, `WITH RECURSIVE name AS
 * (` and each `, name AS (` that follows.
 */
export const extractCteNames = (sql: string): Set<string> => {
  const text = stripStringLiterals(sql).replace(/"/g, ' ');
  const names = new Set<string>();
  const re =
    /(?:\bwith\b\s+(?:recursive\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\([^)]*\)\s*)?\bas\b\s*(?:materialized\s+|not\s+materialized\s+)?\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) names.add(match[1].toLowerCase());
  return names;
};

/**
 * Every relation named after FROM or JOIN. Optional-schema-qualified names are
 * captured whole (`public.users`) so a qualified reference cannot slip past the
 * allowlist by matching only on its last segment.
 */
export const extractTableReferences = (sql: string): string[] => {
  const text = stripStringLiterals(sql).replace(/"/g, ' ');
  const refs: string[] = [];
  const re =
    /\b(?:from|join)\s+((?:[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_$]*)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    refs.push(match[1].replace(/\s+/g, '').toLowerCase());
  }
  return refs;
};

/** Identifiers used as function calls (`name(`), so a table function in a FROM
 *  clause can be told apart from a table name. */
const isFunctionCall = (sql: string, name: string): boolean =>
  new RegExp(`\\b${name}\\s*\\(`, 'i').test(stripStringLiterals(sql));

/**
 * Validate one LLM-authored query. Returns the normalised SQL (trailing
 * semicolon and whitespace removed) or the reason it was refused.
 */
export const guardSelectQuery = (rawSql: string): SqlGuardResult => {
  const sql = (rawSql ?? '')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();

  if (!sql) return { ok: false, reason: 'the query was empty' };
  if (sql.length > AGENT_LIMITS.MAX_SQL_CHARS) {
    return {
      ok: false,
      reason: `the query was longer than ${AGENT_LIMITS.MAX_SQL_CHARS} characters`,
    };
  }

  // Comments can hide a second statement from a reader who is auditing the SQL
  // shown next to the answer, and no generated analytics query needs them.
  if (sql.includes('--') || sql.includes('/*') || sql.includes('*/')) {
    return { ok: false, reason: 'the query contained a SQL comment' };
  }

  // Dollar quoting is how a function body (and arbitrary code) gets smuggled in.
  if (sql.includes('$$')) {
    return { ok: false, reason: 'the query contained dollar quoting' };
  }

  const literalFree = stripStringLiterals(sql);

  // A semicolon anywhere other than the (already-stripped) end means more than
  // one statement.
  if (literalFree.includes(';')) {
    return { ok: false, reason: 'the query contained more than one statement' };
  }

  if (!/^\s*(select|with)\b/i.test(literalFree)) {
    return { ok: false, reason: 'the query was not a SELECT' };
  }

  const identifiers = new Set(extractIdentifiers(sql));

  for (const token of FORBIDDEN_SQL_TOKENS) {
    if (!identifiers.has(token)) continue;
    // `set` inside `date_trunc` etc. never appears as a bare identifier, but
    // window functions and a few legitimate names do collide with keywords, so
    // report the token — the caller retries or shows the reason.
    return {
      ok: false,
      reason: `the query used a forbidden SQL keyword (${token}); the agent may only read data`,
    };
  }

  const lowered = literalFree.toLowerCase();
  for (const fragment of FORBIDDEN_SQL_FRAGMENTS) {
    if (lowered.includes(fragment)) {
      return {
        ok: false,
        reason: `the query referenced ${fragment}, which is not readable`,
      };
    }
  }

  for (const identifier of identifiers) {
    if (
      DENIED_COLUMNS.includes(identifier) ||
      DENIED_COLUMN_PATTERNS.some((pattern) => pattern.test(identifier))
    ) {
      return {
        ok: false,
        reason:
          `the query referenced "${identifier}", which the analytics agent may ` +
          'never read (credentials, personal contact details and session content ' +
          'are out of scope for aggregate analytics)',
      };
    }
  }

  const cteNames = extractCteNames(sql);
  for (const ref of extractTableReferences(sql)) {
    if (cteNames.has(ref)) continue;
    if (ALLOWED_TABLE_FUNCTIONS.includes(ref) && isFunctionCall(sql, ref)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TABLES, ref)) {
      return {
        ok: false,
        reason: `the query read from "${ref}", which is not one of the tables the analytics agent can see`,
      };
    }
  }

  return { ok: true, sql };
};

/**
 * Wrap a guarded query so the database itself bounds the result.
 *
 * Two jobs. The obvious one is the row cap. The subtler one is that a valid
 * wrap is only possible around a single expression-level SELECT: anything that
 * slipped past the guard as a second statement or a non-SELECT fails to parse
 * here rather than executing, so the cap doubles as a structural check that
 * Postgres — not this file's regexes — gets the final say.
 *
 * Asks for `limit + 1` rows so the caller can distinguish a result that happens
 * to be exactly at the cap from one that was cut short, and label a total as a
 * lower bound when it was.
 */
export const wrapWithRowCap = (sql: string, limit: number): string =>
  `SELECT * FROM (\n${sql}\n) AS agent_result LIMIT ${Math.floor(limit) + 1}`;
