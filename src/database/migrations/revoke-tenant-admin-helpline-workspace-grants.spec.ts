import { QueryRunner } from 'typeorm';
import { RevokeTenantAdminHelplineWorkspaceGrants1976600000000 } from './1976600000000-RevokeTenantAdminHelplineWorkspaceGrants';
import {
  ADMIN_PERMISSIONS,
  HELPLINE_SUPERVISOR_PERMISSIONS,
  PERMISSIONS,
} from 'src/authorization/constants/permissions.constants';

const run = async (direction: 'up' | 'down' = 'up') => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const queryRunner = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    }),
  } as unknown as QueryRunner;
  await new RevokeTenantAdminHelplineWorkspaceGrants1976600000000()[direction](
    queryRunner,
  );
  return queries;
};

describe('RevokeTenantAdminHelplineWorkspaceGrants', () => {
  it('scopes the revoke to the ADMIN group, leaving LISTENER and HELPLINE_SUPERVISOR alone', async () => {
    const queries = await run();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("WHERE name = 'ADMIN'");
  });

  it('revokes every workspace permission a supervisor holds', async () => {
    const [revoke] = await run();

    expect([...(revoke.params[0] as string[])].sort()).toEqual(
      [...HELPLINE_SUPERVISOR_PERMISSIONS].sort(),
    );
  });

  it('keeps team management, which opens nothing without a workspace permission', async () => {
    const [revoke] = await run();

    expect(revoke.params[0]).not.toContain(PERMISSIONS.EDIT_HELPLINE_TEAM);
  });

  it('matches the ADMIN list in permissions.constants.ts', async () => {
    const [revoke] = await run();

    for (const name of revoke.params[0] as string[]) {
      expect(ADMIN_PERMISSIONS).not.toContain(name);
    }
    expect(ADMIN_PERMISSIONS).toContain(PERMISSIONS.EDIT_HELPLINE_TEAM);
  });

  it('down restores the same grants to ADMIN only', async () => {
    const [up] = await run('up');
    const [down] = await run('down');

    expect(down.sql).toContain("WHERE g.name = 'ADMIN'");
    expect(down.params[0]).toEqual(up.params[0]);
  });
});
