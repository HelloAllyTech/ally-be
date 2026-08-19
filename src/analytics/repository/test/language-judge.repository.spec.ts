import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { LanguageJudgeRepository } from '../language-judge.repository';

describe('LanguageJudgeRepository.selectJudgmentsMissingRoundTrip', () => {
  let repository: LanguageJudgeRepository;
  let query: jest.Mock;

  /** The session columns the shared projection returns, trimmed to what matters here. */
  const sessionColumns = {
    id: 'sess-1',
    tenant_id: 'tenant-1',
    language: 'en',
  };

  beforeEach(async () => {
    // Stands in for the driver: a column that is not in the SELECT list simply
    // is not on the row. Asserting against a hand-built row would hide exactly
    // this bug, because the row type claims judgment_id is always there.
    query = jest.fn(async (sql: string) =>
      /j\.id\s+AS\s+judgment_id/i.test(sql)
        ? [{ ...sessionColumns, judgment_id: 'judgment-1' }]
        : [{ ...sessionColumns }],
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguageJudgeRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(LanguageJudgeRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('projects the judgment id so the top-up has a row to write to', async () => {
    // Without it every judgmentId is undefined, updateRoundTripWer runs
    // `WHERE id = NULL`, and the drainer reports a top-up that saved nothing.
    const rows = await repository.selectJudgmentsMissingRoundTrip(
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      40,
    );

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/j\.id\s+AS\s+judgment_id/i);
    expect(rows).toHaveLength(1);
    expect(rows[0].judgmentId).toBe('judgment-1');
    expect(rows[0].session.id).toBe('sess-1');
    // The join key must not leak into the session half of the pair.
    expect(rows[0].session).not.toHaveProperty('judgment_id');
  });
});
