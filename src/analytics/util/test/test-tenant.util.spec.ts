import {
  excludeTestTenants,
  excludeTestTenantsBySession,
  excludeTestTenantsByUser,
} from '../test-tenant.util';

/**
 * These predicates are interpolated into ~45 analytics queries, so the contract
 * that matters is structural: parameter-free (so they compose with raw
 * $n-positional SQL without renumbering), null-preserving (so deliberately
 * tenantless rows survive), and matching a tenant on EITHER id-as-text or code
 * (scenario_sessions.tenant_id is a varchar holding either).
 */
describe('test-tenant predicates', () => {
  const all = [
    excludeTestTenants('s."tenant_id"'),
    excludeTestTenantsBySession('l."scenarioSessionId"'),
    excludeTestTenantsByUser('q."userId"'),
  ];

  it('never emits a bind placeholder', () => {
    // A `$1` or `:param` here would silently shift every positional parameter
    // in the raw-SQL callers (language-analytics builds $n off params.length).
    for (const sql of all) {
      expect(sql).not.toMatch(/\$\d/);
      // A single colon followed by a word char is a TypeORM named parameter;
      // the lookbehind lets the `::text` casts through.
      expect(sql).not.toMatch(/(?<!:):\w/);
    }
  });

  it('is null-preserving via NOT EXISTS', () => {
    // NOT EXISTS is true when the tenant reference is NULL, so tenantless
    // llm_usage rows are kept. A `NOT IN` subquery would drop them all.
    for (const sql of all) {
      expect(sql.startsWith('NOT EXISTS (')).toBe(true);
      expect(sql).not.toMatch(/NOT IN/);
    }
  });

  it('gates every lookup on the isTestOrganization flag', () => {
    for (const sql of all) {
      expect(sql).toContain('tt."isTestOrganization" = true');
    }
  });

  it('uses subquery aliases that cannot collide with caller aliases', () => {
    // `t` is already the tenants alias in highlights-analytics's top-orgs join.
    for (const sql of all) {
      expect(sql).not.toMatch(/\btenants t\b(?!t)/);
    }
    expect(excludeTestTenants('s."tenant_id"')).toContain('tenants tt');
    expect(excludeTestTenantsBySession('l."x"')).toContain(
      'scenario_sessions tts',
    );
    expect(excludeTestTenantsByUser('q."x"')).toContain('users ttu');
  });

  describe('excludeTestTenants', () => {
    it('matches on tenant id-as-text OR code, casting both sides', () => {
      const sql = excludeTestTenants('s."tenant_id"');
      // Casting the varchar side to uuid would throw on code values like 'ally';
      // casting both to text keeps one fragment usable for the uuid-typed
      // track_enrollments."tenantId" too.
      expect(sql).toContain('tt.id::text = (s."tenant_id")::text');
      expect(sql).toContain('tt.code = (s."tenant_id")::text');
    });

    it('parenthesises the column expression so OR binds correctly', () => {
      expect(excludeTestTenants('e."tenantId"')).toContain('(e."tenantId")');
    });
  });

  describe('excludeTestTenantsBySession', () => {
    it('correlates on the given session id column', () => {
      const sql = excludeTestTenantsBySession('l."scenarioSessionId"');
      expect(sql).toContain('WHERE tts.id = l."scenarioSessionId"');
      expect(sql).toContain('tt.id::text = tts."tenant_id"');
    });
  });

  describe('excludeTestTenantsByUser', () => {
    it('correlates on the given user id column', () => {
      const sql = excludeTestTenantsByUser('q."userId"');
      expect(sql).toContain('WHERE ttu.id = q."userId"');
      expect(sql).toContain('tt.id::text = ttu."tenant_id"');
    });
  });
});
