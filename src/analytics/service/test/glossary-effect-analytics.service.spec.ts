import { GlossaryEffectAnalyticsService } from '../glossary-effect-analytics.service';

describe('GlossaryEffectAnalyticsService', () => {
  let service: GlossaryEffectAnalyticsService;
  let repo: any;
  let languageRepo: any;

  beforeEach(() => {
    repo = {
      goLiveByLanguage: jest.fn().mockResolvedValue([]),
      totals: jest.fn().mockResolvedValue([]),
      styleCounts: jest.fn().mockResolvedValue([]),
    };
    languageRepo = {
      latestJudgeVersion: jest.fn().mockResolvedValue({
        judgeModel: 'gemini-2.5-pro',
        judgePromptVersion: 'v2',
      }),
    };
    service = new GlossaryEffectAnalyticsService(repo, languageRepo);
  });

  it('pins to the latest judge version rather than keeping its own rule', async () => {
    await service.getGlossaryEffect({});
    expect(languageRepo.latestJudgeVersion).toHaveBeenCalled();
    expect(repo.totals).toHaveBeenCalledWith(
      expect.objectContaining({
        judgeModel: 'gemini-2.5-pro',
        judgePromptVersion: 'v2',
      }),
    );
  });

  it('returns an empty shape when nothing has been judged, without inventing a tuple', async () => {
    languageRepo.latestJudgeVersion.mockResolvedValue(null);
    const out = await service.getGlossaryEffect({});
    expect(out).toEqual({
      judgeVersion: { judgeModel: '', judgePromptVersion: '' },
      goLive: [],
      cells: [],
    });
    expect(repo.totals).not.toHaveBeenCalled();
  });

  it('applies severity weights per cell and normalizes both denominators', async () => {
    repo.totals.mockResolvedValue([
      {
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4o-mini',
        sessions: '10',
        turns: '200',
        agentMessages: '400',
        avoidTermViolations: '20',
        testSessionsExcluded: '3',
      },
    ]);
    repo.styleCounts.mockResolvedValue([
      // 2 minor (2) + 1 major (5) + 1 critical (10) = 17 weighted
      {
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4o-mini',
        severity: 'minor',
        count: '2',
      },
      {
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4o-mini',
        severity: 'major',
        count: '1',
      },
      {
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4o-mini',
        severity: 'critical',
        count: '1',
      },
    ]);

    const { cells } = await service.getGlossaryEffect({});
    expect(cells).toEqual([
      expect.objectContaining({
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4o-mini',
        adherencePer100Messages: 5, // 20 / 400 * 100
        stylePer100Turns: 8.5, // 17 / 200 * 100
        testSessionsExcluded: 3,
      }),
    ]);
  });

  it('does not credit one cell with another cell/model style errors', async () => {
    repo.totals.mockResolvedValue([
      {
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4o-mini',
        sessions: '5',
        turns: '100',
        agentMessages: '100',
        avoidTermViolations: '0',
        testSessionsExcluded: '0',
      },
      {
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4.1-mini',
        sessions: '5',
        turns: '100',
        agentMessages: '100',
        avoidTermViolations: '0',
        testSessionsExcluded: '0',
      },
    ]);
    repo.styleCounts.mockResolvedValue([
      {
        languageValue: 'ta-IN',
        period: 'after',
        agentModel: 'gpt-4.1-mini',
        severity: 'critical',
        count: '10',
      },
    ]);

    const { cells } = await service.getGlossaryEffect({});
    const byModel = Object.fromEntries(
      cells.map((c) => [c.agentModel, c.stylePer100Turns]),
    );
    expect(byModel['gpt-4.1-mini']).toBe(100); // 10 * 10 / 100 * 100
    expect(byModel['gpt-4o-mini']).toBe(0);
  });

  // A zero here would read as flawless; the distinction is the whole point of
  // reporting naturalness separately from the deterministic floor.
  it('reports UNMEASURED naturalness as null, not 0', async () => {
    repo.totals.mockResolvedValue([
      {
        languageValue: 'kn-IN',
        period: 'before',
        agentModel: 'unknown',
        sessions: '4',
        turns: '0',
        agentMessages: '50',
        avoidTermViolations: '25',
        testSessionsExcluded: '0',
      },
    ]);
    const { cells } = await service.getGlossaryEffect({});
    expect(cells[0].stylePer100Turns).toBeNull();
    // Adherence still measurable: its denominator is agent messages.
    expect(cells[0].adherencePer100Messages).toBe(50);
  });

  it('passes the test-org opt-in through as a boolean', async () => {
    await service.getGlossaryEffect({ includeTestOrganizations: 'true' });
    expect(repo.totals).toHaveBeenCalledWith(
      expect.objectContaining({ includeTestOrganizations: true }),
    );
    repo.totals.mockClear();
    await service.getGlossaryEffect({ includeTestOrganizations: 'false' });
    expect(repo.totals).toHaveBeenCalledWith(
      expect.objectContaining({ includeTestOrganizations: false }),
    );
  });

  it('surfaces each language own go-live date as a plain day', async () => {
    repo.goLiveByLanguage.mockResolvedValue([
      {
        languageId: 6,
        languageValue: 'ta-IN',
        languageLabel: 'Tamil (India)',
        goLiveAt: new Date('2026-07-22T10:04:00.000Z'),
      },
      {
        languageId: 1,
        languageValue: 'en-IN',
        languageLabel: 'English (India)',
        goLiveAt: new Date('2026-08-20T06:00:00.000Z'),
      },
    ]);
    const { goLive } = await service.getGlossaryEffect({});
    expect(goLive).toEqual([
      {
        languageValue: 'ta-IN',
        languageLabel: 'Tamil (India)',
        goLiveAt: '2026-07-22',
      },
      {
        languageValue: 'en-IN',
        languageLabel: 'English (India)',
        goLiveAt: '2026-08-20',
      },
    ]);
  });
});
