import { Test, TestingModule } from '@nestjs/testing';
import { LanguageMixAnalyticsService } from '../language-mix-analytics.service';
import {
  LANGUAGE_MIX_OTHER_LABEL,
  LANGUAGE_MIX_UNKNOWN_LABEL,
  LanguageMixAnalyticsRepository,
  LanguageMixBucketRow,
  MAX_LANGUAGE_SERIES,
} from '../../repository/language-mix-analytics.repository';

/**
 * Fixed "now" = Wednesday 2024-06-12T12:00:00Z, with a data floor of 2024-04-10.
 * For the endpoint's defaults (range='all', monthly buckets) that yields the axis
 * 2024-04-01 .. 2024-06-01.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');
const MONTHLY_AXIS = ['2024-04-01', '2024-05-01', '2024-06-01'];
const BUCKET = '2024-05-01';

/** N languages in one bucket, descending in volume: L1 the largest. */
const rankedLanguages = (
  count: number,
  bucket = BUCKET,
): LanguageMixBucketRow[] =>
  Array.from({ length: count }, (_, i) => ({
    bucket,
    label: `L${i + 1}`,
    sessions: (count - i) * 10,
  }));

describe('LanguageMixAnalyticsService', () => {
  let service: LanguageMixAnalyticsService;
  let repo: jest.Mocked<LanguageMixAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<LanguageMixAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getSessionsByBucketAndLanguage: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguageMixAnalyticsService,
        { provide: LanguageMixAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(LanguageMixAnalyticsService);
    repo = module.get(LanguageMixAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to all-time in monthly buckets, measuring the data floor', async () => {
      const res = await service.getLanguageMix({});

      expect(repo.getDataFloor).toHaveBeenCalled();
      expect(res.window).toMatchObject({
        from: '2024-04-10',
        to: '2024-06-12',
        label: 'All time',
        bucket: 'month',
        allTime: true,
      });
      expect(res.maxSeries).toBe(MAX_LANGUAGE_SERIES);
    });

    it('does not measure the data floor for a bounded range', async () => {
      await service.getLanguageMix({ range: '30d' });

      expect(repo.getDataFloor).not.toHaveBeenCalled();
    });
  });

  describe('series ordering', () => {
    it('ranks by window total, not by per-bucket volume', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue([
        // Tamil wins April; Hindi wins the window.
        { bucket: '2024-04-01', label: 'Tamil', sessions: 50 },
        { bucket: '2024-04-01', label: 'Hindi', sessions: 10 },
        { bucket: '2024-05-01', label: 'Hindi', sessions: 90 },
      ]);

      const res = await service.getLanguageMix({});

      expect(res.labels).toEqual(['Hindi', 'Tamil']);
    });

    it('puts Other and Unknown last, in that order', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue([
        ...rankedLanguages(10),
        { bucket: BUCKET, label: LANGUAGE_MIX_UNKNOWN_LABEL, sessions: 5 },
      ]);

      const res = await service.getLanguageMix({});

      expect(res.labels).toHaveLength(MAX_LANGUAGE_SERIES);
      expect(res.labels.slice(-2)).toEqual([
        LANGUAGE_MIX_OTHER_LABEL,
        LANGUAGE_MIX_UNKNOWN_LABEL,
      ]);
      // Unknown reserves its own slot, so six languages stay named.
      expect(res.labels.slice(0, 6)).toEqual([
        'L1',
        'L2',
        'L3',
        'L4',
        'L5',
        'L6',
      ]);
    });
  });

  describe('pooling the tail', () => {
    it('never returns more series than the colour ceiling', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue(
        rankedLanguages(20),
      );

      const res = await service.getLanguageMix({});

      expect(res.labels).toHaveLength(MAX_LANGUAGE_SERIES);
      expect(res.labels[MAX_LANGUAGE_SERIES - 1]).toBe(
        LANGUAGE_MIX_OTHER_LABEL,
      );
    });

    it('pools the tail per bucket, summing the languages it replaced', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue(
        rankedLanguages(10),
      );

      const res = await service.getLanguageMix({});

      // Seven named + Other. The tail (L8=30, L9=20, L10=10) sums to 60.
      expect(res.labels).toEqual([
        'L1',
        'L2',
        'L3',
        'L4',
        'L5',
        'L6',
        'L7',
        LANGUAGE_MIX_OTHER_LABEL,
      ]);
      expect(res.points).toContainEqual({
        bucket: BUCKET,
        label: LANGUAGE_MIX_OTHER_LABEL,
        sessions: 60,
      });
    });

    it('names every language when they all fit — pooling one saves no colour', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue(
        rankedLanguages(MAX_LANGUAGE_SERIES),
      );

      const res = await service.getLanguageMix({});

      expect(res.labels).toHaveLength(MAX_LANGUAGE_SERIES);
      expect(res.labels).not.toContain(LANGUAGE_MIX_OTHER_LABEL);
    });

    it('never pools Unknown into Other — an absence of data is not a small language', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue([
        ...rankedLanguages(12),
        // Smaller than every language in the pooled tail, and still its own band.
        { bucket: BUCKET, label: LANGUAGE_MIX_UNKNOWN_LABEL, sessions: 1 },
      ]);

      const res = await service.getLanguageMix({});

      expect(res.labels).toContain(LANGUAGE_MIX_UNKNOWN_LABEL);
      expect(res.points).toContainEqual({
        bucket: BUCKET,
        label: LANGUAGE_MIX_UNKNOWN_LABEL,
        sessions: 1,
      });
    });
  });

  describe('points', () => {
    it('emits one row per (bucket, label) with sessions, and none without', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue([
        { bucket: '2024-04-01', label: 'Hindi', sessions: 3 },
        { bucket: '2024-05-01', label: 'Tamil', sessions: 2 },
      ]);

      const res = await service.getLanguageMix({});

      // Two labels x three buckets would be six cells; four of them are empty and
      // a zero-height band carries no information.
      expect(res.points).toEqual([
        { bucket: '2024-04-01', label: 'Hindi', sessions: 3 },
        { bucket: '2024-05-01', label: 'Tamil', sessions: 2 },
      ]);
    });
  });

  describe('bucketTotals', () => {
    it('is dense and zero-filled, and totals every label', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue([
        ...rankedLanguages(10),
        { bucket: BUCKET, label: LANGUAGE_MIX_UNKNOWN_LABEL, sessions: 5 },
      ]);

      const res = await service.getLanguageMix({});

      expect(res.bucketTotals.map((b) => b.bucket)).toEqual(MONTHLY_AXIS);
      // 100+90+...+10 = 550, plus 5 unresolved.
      expect(res.bucketTotals[1]).toEqual({ bucket: BUCKET, sessions: 555 });
      // A month with no completed sessions is a real zero, so the axis stays a
      // true calendar.
      expect(res.bucketTotals[0]).toEqual({
        bucket: '2024-04-01',
        sessions: 0,
      });
    });
  });

  describe('summary', () => {
    it('counts distinct languages BEFORE pooling, and Unknown separately', async () => {
      repo.getSessionsByBucketAndLanguage.mockResolvedValue([
        ...rankedLanguages(12),
        { bucket: BUCKET, label: LANGUAGE_MIX_UNKNOWN_LABEL, sessions: 7 },
      ]);

      const res = await service.getLanguageMix({});

      // 12 languages behind 8 series — the trimming must not erase that.
      expect(res.summary.distinctLanguages).toBe(12);
      expect(res.summary.unknownSessions).toBe(7);
      expect(res.summary.totalSessions).toBe(
        rankedLanguages(12).reduce((a, r) => a + r.sessions, 0) + 7,
      );
    });

    it('is empty and label-free for a window with no sessions', async () => {
      const res = await service.getLanguageMix({});

      expect(res.labels).toEqual([]);
      expect(res.points).toEqual([]);
      expect(res.summary).toEqual({
        totalSessions: 0,
        distinctLanguages: 0,
        unknownSessions: 0,
      });
      // The calendar still exists, with real zeros.
      expect(res.bucketTotals.map((b) => b.sessions)).toEqual([0, 0, 0]);
    });
  });

  describe('scoping', () => {
    it('passes a trimmed tenant filter through and echoes it', async () => {
      const res = await service.getLanguageMix({ tenantId: '  ally  ' });

      expect(repo.getSessionsByBucketAndLanguage).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
        'ally',
      );
      expect(res.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
    });

    it('treats a blank tenant filter as no filter', async () => {
      const res = await service.getLanguageMix({ tenantId: '   ' });

      expect(repo.getSessionsByBucketAndLanguage).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
        undefined,
      );
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
