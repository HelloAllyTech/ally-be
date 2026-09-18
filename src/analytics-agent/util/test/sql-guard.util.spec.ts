import {
  extractCteNames,
  extractTableReferences,
  guardSelectQuery,
  stripStringLiterals,
  wrapWithRowCap,
} from '../sql-guard.util';
import { AGENT_LIMITS } from '../../constants/analytics-agent.constants';

/** Assert the query was refused, and return the reason for a further check. */
const refusalFor = (sql: string): string => {
  const result = guardSelectQuery(sql);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.reason;
};

const accept = (sql: string): string => {
  const result = guardSelectQuery(sql);
  // Print the reason on failure — a guard test that fails should say why the
  // guard disagreed, not just that it did.
  expect(result.ok ? '' : result.reason).toBe('');
  return result.ok ? result.sql : '';
};

describe('guardSelectQuery — queries it must accept', () => {
  it('accepts a plain aggregate over an allowlisted table', () => {
    accept(
      "SELECT count(*) AS n FROM analytics_agent_scenario_sessions WHERE started_at >= CURRENT_DATE - INTERVAL '30 days' LIMIT 100",
    );
  });

  it('accepts a WITH ... SELECT', () => {
    accept(`
      WITH weekly AS (
        SELECT date_trunc('week', started_at) AS bucket, count(*) AS n
          FROM analytics_agent_scenario_sessions
         GROUP BY 1
      )
      SELECT bucket, n FROM weekly ORDER BY bucket LIMIT 200
    `);
  });

  it('accepts a multi-CTE query referencing each CTE by name', () => {
    accept(`
      WITH a AS (SELECT id FROM analytics_agent_tenants), b AS (SELECT id FROM analytics_agent_users)
      SELECT (SELECT count(*) FROM a) AS orgs, (SELECT count(*) FROM b) AS people LIMIT 1
    `);
  });

  it('accepts joins across allowlisted tables', () => {
    accept(`
      SELECT t.name AS org, count(s.id) AS sessions
        FROM analytics_agent_scenario_sessions s
        JOIN analytics_agent_tenants t ON t.id = s.tenant_id
       WHERE t.deleted_at IS NULL
       GROUP BY t.name
       ORDER BY sessions DESC
       LIMIT 20
    `);
  });

  it('accepts double-quoted camelCase columns, which this schema needs', () => {
    accept(
      'SELECT avg("compositeScore") AS mean_score, count(*) AS n FROM analytics_agent_scenario_session_details LIMIT 1',
    );
  });

  it('accepts generate_series in a FROM clause, so an empty period is a gap not a missing row', () => {
    accept(`
      SELECT d::date AS bucket, count(s.id) AS n
        FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, INTERVAL '1 day') AS d
        LEFT JOIN analytics_agent_scenario_sessions s ON s.started_at::date = d::date
       GROUP BY 1 ORDER BY 1 LIMIT 40
    `);
  });

  it('does not treat a keyword inside a string literal as a keyword', () => {
    // `'CREATED'` tokenises to a word that must not read as CREATE, or the agent
    // would be unusable on every enum column in the schema.
    accept(
      "SELECT count(*) AS n FROM analytics_agent_scenario_sessions WHERE status = 'CREATED' LIMIT 10",
    );
  });

  it('does not treat a denied column name inside a string literal as a reference', () => {
    accept(
      "SELECT count(*) AS n FROM prompts WHERE prompt_type = 'content' LIMIT 10",
    );
  });

  it('strips a trailing semicolon rather than refusing the query', () => {
    expect(
      accept('SELECT 1 AS one FROM analytics_agent_tenants LIMIT 1;'),
    ).toBe('SELECT 1 AS one FROM analytics_agent_tenants LIMIT 1');
  });
});

describe('guardSelectQuery — statement shape', () => {
  it('refuses an empty query', () => {
    expect(refusalFor('   ')).toMatch(/empty/);
  });

  it('refuses anything that is not a SELECT', () => {
    expect(refusalFor('DELETE FROM users')).toMatch(/not a SELECT|forbidden/i);
    expect(refusalFor('UPDATE users SET status = 1')).toMatch(
      /not a SELECT|forbidden/i,
    );
    expect(refusalFor('DROP TABLE tenants')).toMatch(/not a SELECT|forbidden/i);
  });

  it('refuses a second statement smuggled after a valid SELECT', () => {
    expect(refusalFor('SELECT 1 FROM tenants; DROP TABLE tenants')).toMatch(
      /more than one statement/,
    );
  });

  it('refuses a line comment, which can hide the rest of the query from a reader', () => {
    expect(
      refusalFor('SELECT count(*) FROM tenants -- WHERE 1=1\nLIMIT 1'),
    ).toMatch(/comment/);
  });

  it('refuses a block comment', () => {
    expect(
      refusalFor('SELECT /* sneaky */ count(*) FROM tenants LIMIT 1'),
    ).toMatch(/comment/);
  });

  it('refuses dollar quoting', () => {
    expect(refusalFor('SELECT $$anything$$ FROM tenants LIMIT 1')).toMatch(
      /dollar quoting/,
    );
  });

  it('refuses a query longer than the cap', () => {
    const long = `SELECT ${'a'.repeat(AGENT_LIMITS.MAX_SQL_CHARS)} FROM tenants`;
    expect(refusalFor(long)).toMatch(/longer than/);
  });

  it('refuses SELECT ... INTO, which creates a table', () => {
    expect(
      refusalFor('SELECT id INTO copy_of_tenants FROM tenants LIMIT 1'),
    ).toMatch(/forbidden SQL keyword/);
  });
});

describe('guardSelectQuery — table allowlist', () => {
  it('refuses a table that is not allowlisted', () => {
    // `messages` carries conversation content and is deliberately unreachable.
    expect(refusalFor('SELECT count(*) AS n FROM messages LIMIT 1')).toMatch(
      /not one of the tables/,
    );
  });

  it('refuses audit_logs, which carries IP addresses and user agents', () => {
    expect(refusalFor('SELECT count(*) AS n FROM audit_logs LIMIT 1')).toMatch(
      /not one of the tables/,
    );
  });

  it('refuses a schema-qualified reference to a table that is not allowlisted', () => {
    // Qualification must not be a way past a name-based allowlist.
    expect(
      refusalFor('SELECT count(*) AS n FROM public.messages LIMIT 1'),
    ).toMatch(/not one of the tables/);
  });

  it('refuses a non-allowlisted table reached through a JOIN', () => {
    expect(
      refusalFor(
        'SELECT count(*) AS n FROM analytics_agent_scenario_sessions s JOIN scenario_session_messages m ON m.scenario_session_id = s.id LIMIT 1',
      ),
    ).toMatch(/not one of the tables/);
  });

  it('refuses a function in a FROM clause that is not on the small allowed list', () => {
    expect(
      refusalFor("SELECT * FROM pg_stat_file('/etc/passwd') LIMIT 1"),
    ).toMatch(/pg_stat_file|not one of the tables/);
  });
});

describe('guardSelectQuery — denied columns', () => {
  it('refuses a password column', () => {
    expect(refusalFor('SELECT password FROM users LIMIT 1')).toMatch(
      /never read/,
    );
  });

  it('refuses contact details', () => {
    expect(refusalFor('SELECT email FROM users LIMIT 10')).toMatch(
      /never read/,
    );
    expect(refusalFor('SELECT phone FROM users LIMIT 10')).toMatch(
      /never read/,
    );
  });

  it('refuses a denied column even inside an aggregate', () => {
    // "Just counting" it still reads it, and a WHERE over it turns an aggregate
    // into a search across conversation text.
    expect(refusalFor('SELECT count(email) AS n FROM users LIMIT 1')).toMatch(
      /never read/,
    );
  });

  it('refuses a denied column used only in a WHERE clause', () => {
    expect(
      refusalFor(
        "SELECT count(*) AS n FROM users WHERE email LIKE '%@example.com' LIMIT 1",
      ),
    ).toMatch(/never read/);
  });

  it('refuses a denied column hidden behind quoting', () => {
    expect(refusalFor('SELECT "password" FROM users LIMIT 1')).toMatch(
      /never read/,
    );
  });

  it('refuses columns matching a denied pattern', () => {
    expect(refusalFor('SELECT some_api_key FROM tenants LIMIT 1')).toMatch(
      /never read/,
    );
    expect(refusalFor('SELECT client_secret FROM tenants LIMIT 1')).toMatch(
      /never read/,
    );
  });

  it('allows a column that merely contains a denied word as a substring', () => {
    // `summary_status` is metadata; `summary` is content. A substring rule here
    // would block the honest half of the schema.
    accept(
      'SELECT summary_status, count(*) AS n FROM analytics_agent_chats GROUP BY 1 LIMIT 10',
    );
  });

  it('allows token *count* columns while refusing a token column', () => {
    accept(
      'SELECT sum("totalTokens") AS tokens FROM analytics_agent_llm_usage LIMIT 1',
    );
    expect(
      refusalFor('SELECT token FROM analytics_agent_users LIMIT 1'),
    ).toMatch(/never read/);
  });
});

describe('guardSelectQuery — dangerous functions and catalogs', () => {
  it('refuses pg_sleep', () => {
    expect(refusalFor('SELECT pg_sleep(30) FROM tenants LIMIT 1')).toMatch(
      /pg_sleep/,
    );
  });

  it('refuses reading the file system', () => {
    expect(refusalFor("SELECT pg_read_file('/etc/passwd') LIMIT 1")).toMatch(
      /pg_read_file/,
    );
  });

  it('refuses the system catalogs', () => {
    expect(
      refusalFor('SELECT count(*) FROM pg_catalog.pg_tables LIMIT 1'),
    ).toMatch(/pg_catalog/);
    expect(
      refusalFor('SELECT count(*) FROM information_schema.columns LIMIT 1'),
    ).toMatch(/information_schema/);
  });

  it('refuses session settings functions', () => {
    expect(
      refusalFor("SELECT current_setting('is_superuser') LIMIT 1"),
    ).toMatch(/current_setting/);
  });

  it('refuses cancelling other backends', () => {
    expect(refusalFor('SELECT pg_terminate_backend(1) LIMIT 1')).toMatch(
      /pg_terminate_backend/,
    );
  });
});

describe('helpers', () => {
  it('stripStringLiterals removes literal contents, including escaped quotes', () => {
    expect(stripStringLiterals("SELECT 'a''b' FROM t WHERE x = 'DROP'")).toBe(
      "SELECT '' FROM t WHERE x = ''",
    );
  });

  it('extractCteNames finds plain, multiple and RECURSIVE CTEs', () => {
    expect(
      extractCteNames('WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a'),
    ).toEqual(new Set(['a', 'b']));
    expect(
      extractCteNames('WITH RECURSIVE tree AS (SELECT 1) SELECT * FROM tree'),
    ).toEqual(new Set(['tree']));
  });

  it('extractTableReferences finds FROM and JOIN targets and normalises them', () => {
    expect(
      extractTableReferences(
        'SELECT * FROM Users u JOIN public . tenants t ON true',
      ),
    ).toEqual(['users', 'public.tenants']);
  });

  it('extractTableReferences does not invent a reference for a subquery', () => {
    expect(extractTableReferences('SELECT * FROM (SELECT 1) AS x')).toEqual([]);
  });
});

describe('wrapWithRowCap', () => {
  it('asks for one row more than the cap, so truncation is detectable', () => {
    expect(wrapWithRowCap('SELECT 1', 500)).toContain('LIMIT 501');
  });

  it('wraps the query as a subquery', () => {
    const wrapped = wrapWithRowCap('SELECT 1 AS one', 10);
    expect(wrapped.startsWith('SELECT * FROM (')).toBe(true);
    expect(wrapped).toContain('AS agent_result');
  });

  it('floors a non-integer limit rather than emitting invalid SQL', () => {
    expect(wrapWithRowCap('SELECT 1', 10.7)).toContain('LIMIT 11');
  });
});
