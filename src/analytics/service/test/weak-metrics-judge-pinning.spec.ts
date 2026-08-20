import { WeakMetricsAnalyticsService } from '../weak-metrics-analytics.service';

/**
 * Three judges write the tables behind this tab and they version independently:
 * drift went to v2 for the clienthood labels, language for the dialect_lexicon
 * rubric, groundedness is on its first.
 *
 * A single pin resolved from the drift table and applied to all three is not a
 * simplification, it is a silent emptying: in production it made the language
 * series read 6 annotations out of 1,782, and it would have made a groundedness
 * backfill unreadable no matter how well it ran — those rows land under the
 * groundedness judge's own version.
 */
describe('weak metrics judge pinning', () => {
  const versions = {
    drift: { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
    language: { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
    groundedness: { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
  };
  // Always a miss, so every test exercises the compute path rather than a
  // cached response from a sibling test. Writes are accepted and discarded.
  const redisStub = () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    deleteByPattern: jest.fn().mockResolvedValue(undefined),
  });

  const build = () => {
    const seen: Record<string, unknown> = {};
    const trend = (key: string) =>
      jest.fn().mockImplementation((f: unknown) => {
        seen[key] = f;
        return Promise.resolve([]);
      });

    const repo: Record<string, unknown> = {
      latestDriftJudgeVersion: jest.fn().mockResolvedValue(versions.drift),
      latestLanguageJudgeVersion: jest
        .fn()
        .mockResolvedValue(versions.language),
      latestGroundednessJudgeVersion: jest
        .fn()
        .mockResolvedValue(versions.groundedness),
      understandingWeightedTrend: trend('understanding'),
      groundednessTrend: trend('groundedness'),
      falseNegativeFeedbackTrend: trend('falseNegative'),
      repetitionTurnTrend: trend('repetition'),
      roleSlipTrend: trend('roleSlip'),
      realismWeightedTrend: jest
        .fn()
        .mockImplementation((f: unknown, dim: string) => {
          seen[`realism:${dim}`] = f;
          return Promise.resolve([]);
        }),
      scoreVsLengthPairs: jest.fn().mockResolvedValue([]),
      roleSlipByScenario: jest.fn().mockResolvedValue([]),
      // Records the LANGUAGE pin it was handed, not the drift one — the panel
      // reads annotations, so pinning it to drift would repeat the bug this
      // whole spec exists to catch.
      turnConditionBreakdown: jest
        .fn()
        .mockImplementation((f: unknown, langPin: unknown) => {
          seen['turnConditions'] = f;
          seen['turnConditions:langPin'] = langPin;
          return Promise.resolve([]);
        }),
      filterOptions: jest.fn().mockResolvedValue({
        languages: [],
        models: [],
        promptVersions: [],
        scenarios: [],
      }),
    };
    for (const m of [
      'unresponsiveTurnTrend',
      'rePromptTrend',
      'bargeInTrend',
      'sessionLoopRateTrend',
      'semanticStasisTrend',
      'resolutionTrend',
      'fabricatedQuoteTrend',
      'feedbackToneTrend',
      'unhealthyScoredTrend',
      'roleInversionTrend',
      'overComplianceTrend',
      'inappropriateStasisTrend',
      'counsellorDirectedQuestionTrend',
      'offLanguageTurnTrend',
    ]) {
      repo[m] = trend(m);
    }
    return {
      service: new WeakMetricsAnalyticsService(
        repo as never,
        redisStub() as never,
      ),
      seen,
    };
  };

  const pinOf = (f: unknown) => ({
    judgeModel: (f as { judgeModel: string }).judgeModel,
    judgePromptVersion: (f as { judgePromptVersion: string })
      .judgePromptVersion,
  });

  it('reads the language series through the LANGUAGE judge version', async () => {
    const { service, seen } = build();
    await service.getWeakMetrics({});

    expect(pinOf(seen.understanding)).toEqual(versions.language);
    expect(pinOf(seen['realism:register'])).toEqual(versions.language);
    expect(pinOf(seen['realism:colloquialness'])).toEqual(versions.language);
    expect(pinOf(seen['realism:dialect_lexicon'])).toEqual(versions.language);
  });

  it('reads the groundedness series through the GROUNDEDNESS judge version', async () => {
    const { service, seen } = build();
    await service.getWeakMetrics({});

    expect(pinOf(seen.groundedness)).toEqual(versions.groundedness);
    expect(pinOf(seen.falseNegative)).toEqual(versions.groundedness);
  });

  it('still reads the drift series through the drift version', async () => {
    const { service, seen } = build();
    await service.getWeakMetrics({});

    expect(pinOf(seen.repetition)).toEqual(versions.drift);
    expect(pinOf(seen.roleSlip)).toEqual(versions.drift);
  });

  it('hands the turn-conditions panel BOTH pins, one per family', async () => {
    // The panel counts a turn as faulted if either judge flagged it, so it
    // needs both versions. Passing only the drift pair would silently read the
    // annotations through the wrong rubric — the exact failure the rest of this
    // spec exists to prevent, just in a query that touches two tables at once.
    const { service, seen } = build();
    await service.getWeakMetrics({});

    expect(pinOf(seen.turnConditions)).toEqual(versions.drift);
    expect(seen['turnConditions:langPin']).toEqual(versions.language);
  });

  it('reports all three versions rather than one that speaks for all', async () => {
    const { service } = build();
    const res = await service.getWeakMetrics({});

    expect(res.judgeVersions).toEqual(versions);
    // The legacy single pair stays for compatibility, and it is drift's.
    expect(res.judgePromptVersion).toBe('v2');
  });
});
