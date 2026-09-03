import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { GlossaryEffectAnalyticsRepository } from '../glossary-effect-analytics.repository';

describe('GlossaryEffectAnalyticsRepository', () => {
  let repository: GlossaryEffectAnalyticsRepository;
  let query: jest.Mock;

  // The language's real go-live: its GLOBAL (profileId IS NULL) section.
  const globalCreatedAt = new Date('2026-07-22T10:04:00.000Z');
  // A tenant's variety-profile overlay, published earlier by consolidation for
  // that tenant alone. Its createdAt must NOT become the language's go-live —
  // that is confounder #4 from this file's own header comment.
  const overlayCreatedAt = new Date('2026-06-01T00:00:00.000Z');

  const scopesToGlobalSectionsOnly = (sql: string) =>
    /"profileId"\s+IS\s+NULL/i.test(sql);

  beforeEach(async () => {
    // Stands in for Postgres: MIN(createdAt) over whichever rows the WHERE
    // clause actually admits. A query that forgets to exclude overlay rows
    // gets the earlier overlay date back, exactly like the real table would.
    query = jest.fn(async (sql: string) => [
      {
        languageId: 6,
        languageValue: 'ta-IN',
        languageLabel: 'Tamil (India)',
        goLiveAt: scopesToGlobalSectionsOnly(sql)
          ? globalCreatedAt
          : overlayCreatedAt,
      },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GlossaryEffectAnalyticsRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(GlossaryEffectAnalyticsRepository);
  });

  it('goLiveByLanguage ignores tenant-scoped overlay sections', async () => {
    const rows = await repository.goLiveByLanguage();
    expect(rows[0].goLiveAt).toEqual(globalCreatedAt);
  });

  it('the shared golive CTE ignores tenant-scoped overlay sections', async () => {
    await repository.totals({
      judgeModel: 'gemini-2.5-pro',
      judgePromptVersion: 'v2',
    });
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/"profileId"\s+IS\s+NULL/i);
  });
});
