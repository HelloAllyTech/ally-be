import { Test, TestingModule } from '@nestjs/testing';
import { ScribeAnalyticsService } from '../scribe-analytics.service';
import { ScribeAnalyticsRepository } from '../../repository/scribe-analytics.repository';
import { ChatSummaryStatus } from '../../../chat/entity/chat.entity';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// Fixed "now" = 2024-06-12T12:00:00Z. range='30d' -> daily axis
// 2024-05-14 .. 2024-06-12 (30 days), endExclusive 2024-06-13.
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

describe('ScribeAnalyticsService', () => {
  let service: ScribeAnalyticsService;
  let repo: jest.Mocked<ScribeAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<ScribeAnalyticsRepository>> = {
      getSessionsByBucket: jest.fn().mockResolvedValue([]),
      getOutcomeCounts: jest.fn().mockResolvedValue([]),
      getModeCounts: jest.fn().mockResolvedValue([]),
      getCaptureMethodCounts: jest.fn().mockResolvedValue([]),
      getFailureRateByBucket: jest.fn().mockResolvedValue([]),
      getFailureBreakdown: jest.fn().mockResolvedValue([]),
      getFailuresByMode: jest.fn().mockResolvedValue([]),
      getFailuresByCaptureMethod: jest.fn().mockResolvedValue([]),
      getFailureRetryableCounts: jest.fn().mockResolvedValue([
        { key: 'retryable', count: 0 },
        { key: 'terminal', count: 0 },
      ]),
      getFailureTimeoutCounts: jest.fn().mockResolvedValue([
        { key: 'timeout', count: 0 },
        { key: 'other', count: 0 },
      ]),
      getFirstAttemptFailureRateByBucket: jest.fn().mockResolvedValue([]),
      getPhaseDropoff: jest.fn().mockResolvedValue([]),
      getSttProviderStats: jest.fn().mockResolvedValue([]),
      getSummaryModelStats: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScribeAnalyticsService,
        { provide: ScribeAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(ScribeAnalyticsService);
    repo = module.get(ScribeAnalyticsRepository);
  });

  afterEach(() => jest.useRealTimers());

  describe('getOverview', () => {
    it('gap-fills the daily trend and computes the success rate (share of all sessions)', async () => {
      repo.getSessionsByBucket.mockResolvedValue([
        { bucket: '2024-06-12', count: 5 },
        { bucket: '2024-06-10', count: 3 },
      ]);
      repo.getOutcomeCounts.mockResolvedValue([
        { key: ChatSummaryStatus.SUCCESS, count: 80 },
        { key: ChatSummaryStatus.FAILED, count: 20 },
        { key: ChatSummaryStatus.IN_PROGRESS, count: 5 },
        { key: ChatSummaryStatus.NO_AUDIO, count: 10 },
      ]);
      repo.getModeCounts.mockResolvedValue([
        { key: 'SCRIBE', count: 90 },
        { key: 'DICTATION', count: 25 },
      ]);

      const res = await service.getOverview('30d');

      expect(res.range).toBe('30d');
      expect(res.bucket).toBe('day');
      // 30-day continuous axis, gap-filled.
      expect(res.sessionsTrend).toHaveLength(30);
      expect(res.sessionsTrend[0]).toEqual({ bucket: '2024-05-14', count: 0 });
      expect(res.sessionsTrend[res.sessionsTrend.length - 1]).toEqual({
        bucket: '2024-06-12',
        count: 5,
      });
      expect(
        res.sessionsTrend.find((p) => p.bucket === '2024-06-10')?.count,
      ).toBe(3);

      // success / total = 80 / 115 = 69.6% — share of ALL sessions, so it
      // matches the "Summarised" slice of the outcome donut.
      expect(res.summary.successRatePct).toBe(69.6);
      expect(res.summary.failed).toBe(20);
      expect(res.summary.processing).toBe(5);
      expect(res.summary.noAudio).toBe(10);
      expect(res.summary.totalSessions).toBe(115);

      // Outcome breakdown is returned in fixed order incl. zero buckets.
      expect(res.outcomeBreakdown.map((o) => o.key)).toEqual([
        'SUCCESS',
        'FAILED',
        'IN_PROGRESS',
        'PENDING',
        'NO_AUDIO',
      ]);
      expect(res.outcomeBreakdown.find((o) => o.key === 'PENDING')?.count).toBe(
        0,
      );
      expect(res.modeBreakdown).toEqual([
        { key: 'SCRIBE', count: 90 },
        { key: 'DICTATION', count: 25 },
      ]);
    });

    it('returns the capture-method breakdown (all sessions) alongside note mode', async () => {
      repo.getCaptureMethodCounts.mockResolvedValue([
        { key: 'live', count: 70 },
        { key: 'upload', count: 45 },
      ]);
      const res = await service.getOverview('30d');
      expect(res.captureBreakdown).toEqual([
        { key: 'live', count: 70 },
        { key: 'upload', count: 45 },
      ]);
    });

    it('returns a 0% success rate when nothing has been summarised', async () => {
      repo.getOutcomeCounts.mockResolvedValue([
        { key: ChatSummaryStatus.IN_PROGRESS, count: 3 },
      ]);
      const res = await service.getOverview('30d');
      // 0 summarised / 3 total = 0%.
      expect(res.summary.successRatePct).toBe(0);
      expect(res.summary.totalSessions).toBe(3);
    });
  });

  describe('getSummaryFailures', () => {
    it('computes failure-rate trend + summary shares', async () => {
      repo.getFailureRateByBucket.mockResolvedValue([
        { bucket: '2024-06-12', failed: 2, terminal: 10 },
        { bucket: '2024-06-11', failed: 0, terminal: 4 },
      ]);
      repo.getFailureBreakdown.mockResolvedValue([
        { key: 'Upload never finalized (abnormal end)', count: 1 },
        { key: 'Summarization error', count: 1 },
      ]);
      repo.getFailureRetryableCounts.mockResolvedValue([
        { key: 'retryable', count: 1 },
        { key: 'terminal', count: 1 },
      ]);
      repo.getFailureTimeoutCounts.mockResolvedValue([
        { key: 'timeout', count: 1 },
        { key: 'other', count: 1 },
      ]);

      const res = await service.getSummaryFailures('30d');

      expect(res.failureRateTrend).toHaveLength(30);
      const last = res.failureRateTrend[res.failureRateTrend.length - 1];
      expect(last).toEqual({
        bucket: '2024-06-12',
        failed: 2,
        terminal: 10,
        failureRate: 0.2,
        firstAttemptFailed: 0,
        firstAttemptTerminal: 0,
        firstAttemptFailureRate: 0,
      });
      // window totals: failed 2, terminal 14 -> 14.3%
      expect(res.summary.totalFailed).toBe(2);
      expect(res.summary.totalTerminal).toBe(14);
      expect(res.summary.failureRatePct).toBe(14.3);
      // retryable 1 of 2 failures = 50%, timeout 1 of 2 = 50%
      expect(res.summary.retryableSharePct).toBe(50);
      expect(res.summary.timeoutSharePct).toBe(50);
      expect(res.failureBreakdown).toHaveLength(2);
    });

    it('merges the first-attempt series alongside the final failure rate', async () => {
      // Final (post-backfill) rate is low, but the FIRST-attempt rate is high —
      // exactly the gap backfill hides.
      repo.getFailureRateByBucket.mockResolvedValue([
        { bucket: '2024-06-12', failed: 1, terminal: 10 },
      ]);
      repo.getFirstAttemptFailureRateByBucket.mockResolvedValue([
        { bucket: '2024-06-12', failed: 6, terminal: 10 },
      ]);

      const res = await service.getSummaryFailures('30d');
      const last = res.failureRateTrend[res.failureRateTrend.length - 1];

      expect(last.failureRate).toBeCloseTo(0.1, 4); // final: 1/10
      expect(last.firstAttemptFailed).toBe(6);
      expect(last.firstAttemptTerminal).toBe(10);
      expect(last.firstAttemptFailureRate).toBeCloseTo(0.6, 4); // first: 6/10
    });

    it('builds a cumulative phase funnel from the drop-off distribution', async () => {
      repo.getPhaseDropoff.mockResolvedValue([
        { key: 'audio-uploaded', count: 3 }, // stuck at upload (cross-replica)
        { key: 'diarized', count: 2 }, // summarize failed
        { key: 'delivered', count: 5 }, // succeeded
      ]);

      const res = await service.getSummaryFailures('30d');
      const funnel = res.phaseFunnel;

      // ladder order preserved
      expect(funnel.map((p) => p.phase)).toEqual([
        'created',
        'audio-uploaded',
        'transcribed',
        'diarized',
        'summarized',
        'delivered',
      ]);
      const reached = Object.fromEntries(
        funnel.map((p) => [p.phase, p.reached]),
      );
      // reached is cumulative from the end: 10 total reached audio-uploaded,
      // 7 reached diarized, 5 reached delivered.
      expect(reached['created']).toBe(10);
      expect(reached['audio-uploaded']).toBe(10);
      expect(reached['transcribed']).toBe(7);
      expect(reached['diarized']).toBe(7);
      expect(reached['summarized']).toBe(5);
      expect(reached['delivered']).toBe(5);
      expect(
        funnel.find((p) => p.phase === 'audio-uploaded')?.stoppedHere,
      ).toBe(3);
    });

    it('passes through STT provider + summary model stats', async () => {
      repo.getSttProviderStats.mockResolvedValue([
        { provider: 'deepgram', tried: 10, ok: 3, failed: 7 },
        { provider: 'openai', tried: 7, ok: 7, failed: 0 },
      ]);
      repo.getSummaryModelStats.mockResolvedValue([
        { key: 'gpt-4o-mini', count: 9 },
      ]);

      const res = await service.getSummaryFailures('30d');
      expect(res.sttProviderStats).toHaveLength(2);
      expect(res.sttProviderStats[0]).toMatchObject({
        provider: 'deepgram',
        failed: 7,
      });
      expect(res.summaryModelStats[0]).toMatchObject({
        key: 'gpt-4o-mini',
        count: 9,
      });
    });

    it('keeps sub-10% ratio precision in the trend (no 10% quantization)', async () => {
      // 1 of 7 = 14.29% — must NOT collapse to 0.1 (10%).
      repo.getFailureRateByBucket.mockResolvedValue([
        { bucket: '2024-06-12', failed: 1, terminal: 7 },
      ]);

      const res = await service.getSummaryFailures('30d');
      const last = res.failureRateTrend[res.failureRateTrend.length - 1];

      expect(last.failureRate).toBeCloseTo(0.1429, 4);
      expect(last.failureRate).not.toBe(0.1);
    });

    it('handles zero failures without dividing by zero', async () => {
      const res = await service.getSummaryFailures('30d');
      expect(res.summary.failureRatePct).toBe(0);
      expect(res.summary.retryableSharePct).toBe(0);
      expect(res.summary.timeoutSharePct).toBe(0);
      expect(res.failureRateTrend.every((p) => p.failureRate === 0)).toBe(true);
    });
  });
});
