import { QueryRunner } from 'typeorm';
import { ScrubImpersonationAuditPasswordHashes1979510000000 } from './1979510000000-ScrubImpersonationAuditPasswordHashes';

const run = async (direction: 'up' | 'down') => {
  const queries: string[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  await new ScrubImpersonationAuditPasswordHashes1979510000000()[direction](
    queryRunner,
  );
  return queries;
};

describe('ScrubImpersonationAuditPasswordHashes', () => {
  it('removes only the password key, and only from impersonation rows', async () => {
    const [scrub] = await run('up');

    expect(scrub).toContain(`"details" #- '{userDetails,password}'`);
    expect(scrub).toContain(`"eventType" = 'SUPER_ADMIN_IMPERSONATE'`);
    expect(scrub).not.toMatch(/DELETE/i);
  });

  it('skips rows whose userDetails is not an object', async () => {
    const [scrub] = await run('up');

    expect(scrub).toContain(
      `jsonb_typeof("details" -> 'userDetails') = 'object'`,
    );
  });

  it('does nothing on the way down — a removed hash cannot be restored', async () => {
    expect(await run('down')).toEqual([]);
  });
});
