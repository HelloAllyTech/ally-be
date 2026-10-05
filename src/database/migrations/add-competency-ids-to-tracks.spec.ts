import { QueryRunner } from 'typeorm';

import { AddCompetencyIdsToTracks1975730000000 } from './1975730000000-AddCompetencyIdsToTracks';

const run = async (direction: 'up' | 'down') => {
  const queries: string[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  await new AddCompetencyIdsToTracks1975730000000()[direction](queryRunner);
  return queries;
};

describe('AddCompetencyIdsToTracks', () => {
  it('adds a nullable jsonb column, stored like scenarios."competencyIds"', async () => {
    const [addColumn] = await run('up');
    expect(addColumn).toBe(
      `ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "competencyIds" jsonb`,
    );
    expect(addColumn).not.toContain('NOT NULL');
    expect(addColumn).not.toContain('DEFAULT');
  });

  it('constrains the column to NULL or a non-empty array of strings', async () => {
    const [, check] = await run('up');
    expect(check).toContain('"CHK_tracks_competency_ids_shape"');
    expect(check).toContain(`"competencyIds" IS NULL`);
    expect(check).toContain(`jsonb_typeof("competencyIds") = 'array'`);
    expect(check).toContain(`"competencyIds" <> '[]'::jsonb`);
    expect(check).toContain(`@? '$[*] ? (@.type() != "string")'`);
    // Postgres rejects a subquery or set-returning function inside a CHECK at
    // parse time — on an empty table too — so neither may creep in.
    expect(check).not.toMatch(/SELECT|jsonb_array_elements/i);
  });

  it('drops the constraint before the column, and both idempotently', async () => {
    const queries = await run('down');
    expect(queries).toEqual([
      `ALTER TABLE "tracks" DROP CONSTRAINT IF EXISTS "CHK_tracks_competency_ids_shape"`,
      `ALTER TABLE "tracks" DROP COLUMN IF EXISTS "competencyIds"`,
    ]);
  });
});
