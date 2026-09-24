import { WeakMetricsAnalyticsService } from '../weak-metrics-analytics.service';
import { WeakMetricsBucket } from '../../dto/weak-metrics.dto';

/**
 * `computeWeakMetrics` used to resolve its bucket with
 * `query.bucket === WeakMetricsBucket.WEEK ? 'week' : 'month'` — a two-way
 * ternary that read anything other than a literal WEEK as MONTH. That was
 * invisible while week/month were the only legal values; the moment 'quarter'
 * became a legal request, the same line would have silently computed and
 * labelled it as monthly instead — the exact class of bug Phase 0 fixed for 13
 * other repositories' `resolveBucket` copies, just not yet applied here. This
 * pins the fix: an explicit quarter request resolves to quarter, not to the
 * month fallback, both in the filters handed to the repository and in the
 * bucket the response reports.
 */
describe('WeakMetricsAnalyticsService bucket resolution', () => {
  const redisStub = () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    deleteByPattern: jest.fn().mockResolvedValue(undefined),
  });

  const build = () => {
    let seenBucket: string | undefined;
    const trend = jest.fn().mockImplementation((f: { bucket: string }) => {
      seenBucket = f.bucket;
      return Promise.resolve([]);
    });

    const repo: Record<string, unknown> = {
      latestDriftJudgeVersion: jest.fn().mockResolvedValue(null),
      latestLanguageJudgeVersion: jest.fn().mockResolvedValue(null),
      latestGroundednessJudgeVersion: jest.fn().mockResolvedValue(null),
      realismWeightedTrend: jest.fn().mockResolvedValue([]),
      scoreVsLengthPairs: jest.fn().mockResolvedValue([]),
      roleSlipByScenario: jest.fn().mockResolvedValue([]),
      turnConditionBreakdown: jest.fn().mockResolvedValue([]),
      filterOptions: jest.fn().mockResolvedValue({
        languages: [],
        models: [],
        promptVersions: [],
        scenarios: [],
      }),
    };
    for (const m of [
      'understandingWeightedTrend',
      'unresponsiveTurnTrend',
      'rePromptTrend',
      'bargeInTrend',
      'repetitionTurnTrend',
      'sessionLoopRateTrend',
      'semanticStasisTrend',
      'resolutionTrend',
      'offLanguageTurnTrend',
      'fabricatedQuoteTrend',
      'groundednessTrend',
      'falseNegativeFeedbackTrend',
      'feedbackToneTrend',
      'unhealthyScoredTrend',
      'roleSlipTrend',
      'roleInversionTrend',
      'overComplianceTrend',
      'inappropriateStasisTrend',
      'counsellorDirectedQuestionTrend',
    ]) {
      repo[m] = trend;
    }

    return {
      service: new WeakMetricsAnalyticsService(
        repo as never,
        redisStub() as never,
      ),
      bucketSeenByRepo: () => seenBucket,
    };
  };

  it('resolves an explicit quarter request to quarter, not the month fallback', async () => {
    const { service, bucketSeenByRepo } = build();
    const res = await service.getWeakMetrics({
      bucket: WeakMetricsBucket.QUARTER,
    });

    expect(res.bucket).toBe('quarter');
    expect(bucketSeenByRepo()).toBe('quarter');
  });

  it('still resolves an explicit week request to week', async () => {
    const { service, bucketSeenByRepo } = build();
    const res = await service.getWeakMetrics({
      bucket: WeakMetricsBucket.WEEK,
    });

    expect(res.bucket).toBe('week');
    expect(bucketSeenByRepo()).toBe('week');
  });

  it('keeps month as the default when no bucket is requested', async () => {
    const { service, bucketSeenByRepo } = build();
    const res = await service.getWeakMetrics({});

    expect(res.bucket).toBe('month');
    expect(bucketSeenByRepo()).toBe('month');
  });
});
