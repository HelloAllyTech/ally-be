import {
  PRACTICE_THRESHOLDS,
  PracticeQualityAnalyticsRepository,
  PracticeQualityRow,
} from '../../repository/practice-quality-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import {
  PracticeQualityAnalyticsService,
  buildPracticeQuality,
} from '../practice-quality-analytics.service';

const row = (
  bucket: string | null,
  extra: Partial<PracticeQualityRow> = {},
): PracticeQualityRow => ({
  bucket,
  sessions: 30,
  talkShareSessions: 28,
  talkShareP25: 31.54,
  talkShareMedian: 44.06,
  talkShareP75: 52.25,
  learnerTurnsMedian: 7.5,
  practiceSessions: 21,
  shortTurnSessions: 4,
  ...extra,
});

describe('buildPracticeQuality', () => {
  const labels = ['2026-01-01', '2026-02-01', '2026-03-01'];

  it('gap-fills every bucket: counts get real zeros, percentiles and shares null', () => {
    const { points } = buildPracticeQuality(
      [row('2026-01-01'), row(null)],
      labels,
      MIN_SCORE_SAMPLE_SIZE,
    );
    expect(points.map((p) => p.bucket)).toEqual(labels);
    expect(points[0]).toEqual({
      bucket: '2026-01-01',
      sessions: 30,
      talkShareSessions: 28,
      talkShareMedianPct: 44.1,
      talkShareP25Pct: 31.5,
      talkShareP75Pct: 52.3,
      learnerTurnsMedian: 7.5,
      practiceSessions: 21,
      practicePct: 70,
      shortTurnSessions: 4,
      shortTurnsPct: 13.3,
    });
    // An empty bucket: nobody practised is a zero; its share is not 0%.
    expect(points[1]).toEqual({
      bucket: '2026-02-01',
      sessions: 0,
      talkShareSessions: 0,
      talkShareMedianPct: null,
      talkShareP25Pct: null,
      talkShareP75Pct: null,
      learnerTurnsMedian: null,
      practiceSessions: 0,
      practicePct: null,
      shortTurnSessions: 0,
      shortTurnsPct: null,
    });
  });

  it('withholds below the floor while the counts travel', () => {
    const { points } = buildPracticeQuality(
      [
        // 19 sessions: under the floor for shares and turns.
        row('2026-01-01', { sessions: 19, talkShareSessions: 19 }),
        // 25 sessions but only 12 with speech: talk share withheld, shares shown.
        row('2026-02-01', {
          sessions: 25,
          talkShareSessions: 12,
          practiceSessions: 5,
        }),
      ],
      labels,
      MIN_SCORE_SAMPLE_SIZE,
    );
    expect(points[0]).toMatchObject({
      sessions: 19,
      practiceSessions: 21,
      practicePct: null,
      shortTurnsPct: null,
      talkShareMedianPct: null,
      learnerTurnsMedian: null,
    });
    expect(points[1]).toMatchObject({
      sessions: 25,
      talkShareSessions: 12,
      talkShareMedianPct: null,
      talkShareP25Pct: null,
      learnerTurnsMedian: 7.5,
      practicePct: 20,
      shortTurnsPct: 16,
    });
  });

  it('takes the summary from the whole-window row, not from the buckets', () => {
    const { summary } = buildPracticeQuality(
      [
        row('2026-01-01'),
        row(null, {
          sessions: 60,
          talkShareSessions: 50,
          talkShareMedian: 40,
          practiceSessions: 30,
          shortTurnSessions: 15,
        }),
      ],
      labels,
      MIN_SCORE_SAMPLE_SIZE,
    );
    expect(summary).toEqual({
      sessions: 60,
      talkShareSessions: 50,
      talkShareMedianPct: 40,
      talkShareP25Pct: 31.5,
      talkShareP75Pct: 52.3,
      learnerTurnsMedian: 7.5,
      practiceSessions: 30,
      practicePct: 50,
      shortTurnSessions: 15,
      notPracticeShortTurnsPct: 25,
    });
  });

  it('returns zeros and nulls, never a 0%, when there is no data', () => {
    const { summary, points } = buildPracticeQuality([], labels, 20);
    expect(points).toHaveLength(3);
    expect(summary).toEqual({
      sessions: 0,
      talkShareSessions: 0,
      talkShareMedianPct: null,
      talkShareP25Pct: null,
      talkShareP75Pct: null,
      learnerTurnsMedian: null,
      practiceSessions: 0,
      practicePct: null,
      shortTurnSessions: 0,
      notPracticeShortTurnsPct: null,
    });
  });
});

describe('PracticeQualityAnalyticsService', () => {
  const make = (rows: PracticeQualityRow[] = []) => {
    const repo = {
      getDataFloor: jest
        .fn()
        .mockResolvedValue(new Date('2026-01-15T00:00:00.000Z')),
      getPracticeQuality: jest.fn().mockResolvedValue(rows),
    };
    const service = new PracticeQualityAnalyticsService(
      repo as unknown as PracticeQualityAnalyticsRepository,
    );
    return { repo, service };
  };

  it('defaults to all time by month, from the platform data floor', async () => {
    const { repo, service } = make([row(null)]);
    const res = await service.getPracticeQuality({});

    expect(repo.getDataFloor).toHaveBeenCalledTimes(1);
    const [start, , bucket, opts] = repo.getPracticeQuality.mock.calls[0];
    expect(start).toEqual(new Date('2026-01-15T00:00:00.000Z'));
    expect(bucket).toBe('month');
    expect(opts).toEqual({ tenantId: undefined, language: undefined });
    expect(res.window.allTime).toBe(true);
    expect(res.points[0].bucket).toBe('2026-01-01');
    expect(res.language).toBeNull();
    expect(res.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(res.practiceThresholds).toEqual({
      minLearnerTurns: 3,
      minDurationMinutes: 2,
      minLearnerChars: 300,
    });
    expect(res.practiceThresholds).toEqual({ ...PRACTICE_THRESHOLDS });
    expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    expect(res.provenance.derivation).toContain('R7');
    expect(res.provenance.note).toContain('within one language');
  });

  it('passes a custom window, trimmed org and language through without the floor', async () => {
    const { repo, service } = make();
    const res = await service.getPracticeQuality({
      from: '2026-03-01',
      to: '2026-03-31',
      bucket: 'week',
      tenantId: ' ally ',
      language: ' hi-IN ',
    });

    expect(repo.getDataFloor).not.toHaveBeenCalled();
    const [start, end, bucket, opts] = repo.getPracticeQuality.mock.calls[0];
    expect(start).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(end).toEqual(new Date('2026-04-01T00:00:00.000Z'));
    expect(bucket).toBe('week');
    expect(opts).toEqual({ tenantId: 'ally', language: 'hi-IN' });
    expect(res.language).toBe('hi-IN');
    expect(res.scoping.tenantId).toBe('ally');
    // Mondays covering March 2026.
    expect(res.points.map((p) => p.bucket)).toEqual([
      '2026-02-23',
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
      '2026-03-30',
    ]);
  });
});
