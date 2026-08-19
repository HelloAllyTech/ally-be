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
      'quoteMatchTrend',
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
    return { service: new WeakMetricsAnalyticsService(repo as never), seen };
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

  it('reports all three versions rather than one that speaks for all', async () => {
    const { service } = build();
    const res = await service.getWeakMetrics({});

    expect(res.judgeVersions).toEqual(versions);
    // The legacy single pair stays for compatibility, and it is drift's.
    expect(res.judgePromptVersion).toBe('v2');
  });
});
