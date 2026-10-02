import { QueryRunner } from 'typeorm';

import { ProductUpdatesPublicByDefault1975100000000 } from './1975100000000-ProductUpdatesPublicByDefault';

const run = async () => {
  const queries: string[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  await new ProductUpdatesPublicByDefault1975100000000().up(queryRunner);
  return queries;
};

describe('ProductUpdatesPublicByDefault', () => {
  it('flips internal updates to public and publishes the live ones on their live date', async () => {
    const [sql] = await run();

    expect(sql).toContain(`"audience" = 'public'`);
    expect(sql).toContain(`WHERE "audience" = 'internal'`);
    expect(sql).toContain(`COALESCE("published_at", "live_at")`);
  });

  it('leaves hand-set audiences, hidden updates and unplaced changes alone', async () => {
    const [sql] = await run();

    expect(sql).toContain(`NOT ('audience' = ANY("edited_fields"))`);
    expect(sql).toContain(`"hidden" = false`);
    expect(sql).toContain(`"model" IS NOT NULL`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
  });
});
