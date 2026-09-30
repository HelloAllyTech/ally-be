import { QueryRunner } from 'typeorm';
import { RevokeTenantAdminOrgSettingsGrants1974700000000 } from './1974700000000-RevokeTenantAdminOrgSettingsGrants';
import {
  ADMIN_PERMISSIONS,
  PERMISSIONS,
} from 'src/authorization/constants/permissions.constants';

const run = async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const queryRunner = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    }),
  } as unknown as QueryRunner;
  await new RevokeTenantAdminOrgSettingsGrants1974700000000().up(queryRunner);
  return queries;
};

describe('RevokeTenantAdminOrgSettingsGrants', () => {
  it('scopes the revoke to the ADMIN group, leaving platform-tier grants alone', async () => {
    const [revoke] = await run();

    expect(revoke.sql).toContain("WHERE name = 'ADMIN'");
    expect(revoke.params[0]).toContain('edit:scenario-tenant');
  });

  it('keeps the grants the Scribe call summary and custom-fields dialog still read', async () => {
    const [revoke] = await run();
    const revoked = revoke.params[0] as string[];

    expect(revoked).not.toContain(PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS);
    expect(revoked).not.toContain(PERMISSIONS.VIEW_SETTINGS_CUSTOM_FIELD_TYPES);
    expect(revoked).not.toContain(PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS);
  });

  it('matches the ADMIN list in permissions.constants.ts', async () => {
    const [revoke] = await run();

    for (const name of revoke.params[0] as string[]) {
      expect(ADMIN_PERMISSIONS).not.toContain(name);
    }
  });

  it('deletes the own-tenant settings permissions outright', async () => {
    const queries = await run();
    const deletes = queries.filter((q) =>
      q.sql.startsWith('DELETE FROM "permissions"'),
    );

    expect(deletes).toHaveLength(1);
    expect(deletes[0].params[0]).toEqual([
      'view:own-tenant:settings',
      'edit:own-tenant:settings',
    ]);
  });
});
