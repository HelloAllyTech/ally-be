import { Test, TestingModule } from '@nestjs/testing';

import { QualitySentimentAnalyticsService } from '../quality-sentiment-analytics.service';
import {
  MIN_SENTIMENT_RESPONSES,
  QualitySentimentAnalyticsRepository,
  QualitySentimentBucketRow,
} from '../../repository/quality-sentiment-analytics.repository';

const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const row = (
  overrides: Partial<QualitySentimentBucketRow> = {},
): QualitySentimentBucketRow => ({
  bucket: '2024-05-01',
  avgCompositeScore: null,
  evaluatedSessions: 0,
  responses: 0,
  promoters: 0,
  passives: 0,
  detractors: 0,
  avgRating: null,
  ...overrides,
});

describe('QualitySentimentAnalyticsService', () => {
  let service: QualitySentimentAnalyticsService;

  const setup = async (rows: QualitySentimentBucketRow[] = []) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualitySentimentAnalyticsService,
        {
          provide: QualitySentimentAnalyticsRepository,
          useValue: {
            getByBucket: jest.fn().mockResolvedValue(rows),
            getDataFloor: jest
              .fn()
              .mockResolvedValue(new Date('2024-01-01T00:00:00.000Z')),
          },
        },
      ],
    }).compile();

    service = module.get(QualitySentimentAnalyticsService);
  };

  const monthly = () =>
    service.getQualitySentiment({ range: '12m', bucket: 'month' });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the proxy NPS', () => {
    it('scores %promoters - %detractors on the -100..+100 scale', async () => {
      await setup([
        row({ responses: 10, promoters: 6, passives: 2, detractors: 2 }),
      ]);
      const result = await monthly();
      const may = result.points.find((p) => p.bucket === '2024-05-01');

      // 60% promoters - 20% detractors.
      expect(may?.proxyNps).toBe(40);
    });

    it('can go negative', async () => {
      await setup([
        row({ responses: 10, promoters: 1, passives: 1, detractors: 8 }),
      ]);
      const result = await monthly();

      expect(
        result.points.find((p) => p.bucket === '2024-05-01')?.proxyNps,
      ).toBe(-70);
    });

    it('is suppressed below the response floor, where one rating swings it', async () => {
      await setup([
        row({
          responses: MIN_SENTIMENT_RESPONSES - 1,
          promoters: MIN_SENTIMENT_RESPONSES - 1,
        }),
      ]);
      const result = await monthly();
      const may = result.points.find((p) => p.bucket === '2024-05-01');

      expect(may?.proxyNps).toBeNull();
      // The underlying counts are still there for a table.
      expect(may?.responses).toBe(MIN_SENTIMENT_RESPONSES - 1);
      expect(result.minResponses).toBe(MIN_SENTIMENT_RESPONSES);
    });

    it('carries a mandatory proxy caveat in the payload', async () => {
      await setup([]);
      const result = await monthly();

      expect(result.proxyNote).toMatch(/not NPS/i);
      expect(result.proxyNote).toMatch(/1-5/);
    });
  });

  describe('the axis', () => {
    it('gap-fills both means with NULL, never zero', async () => {
      await setup([
        row({
          bucket: '2024-05-01',
          avgCompositeScore: 72.5,
          evaluatedSessions: 20,
          responses: 10,
          promoters: 5,
          detractors: 3,
        }),
      ]);
      const result = await monthly();

      const may = result.points.find((p) => p.bucket === '2024-05-01');
      expect(may?.avgCompositeScore).toBe(72.5);

      // A quiet month must break the line, not draw a collapse to zero (or to
      // -100, which is what a zeroed proxy NPS would imply).
      const april = result.points.find((p) => p.bucket === '2024-04-01');
      expect(april?.avgCompositeScore).toBeNull();
      expect(april?.proxyNps).toBeNull();
      expect(april?.evaluatedSessions).toBe(0);
    });

    it('stays contiguous over the resolved window', async () => {
      await setup([]);
      const result = await monthly();

      expect(result.points).toHaveLength(12);
      const buckets = result.points.map((p) => p.bucket);
      expect(buckets).toEqual([...buckets].sort());
    });
  });

  describe('whole-window figures', () => {
    it('weights the mean score by sessions, not by bucket', async () => {
      await setup([
        row({
          bucket: '2024-04-01',
          avgCompositeScore: 90,
          evaluatedSessions: 90,
        }),
        row({
          bucket: '2024-05-01',
          avgCompositeScore: 50,
          evaluatedSessions: 10,
        }),
      ]);
      const result = await monthly();

      // Averaging the two bucket means would give 70; the busy month must
      // dominate.
      expect(result.overallCompositeScore).toBeCloseTo(86, 1);
      expect(result.totalEvaluatedSessions).toBe(100);
    });

    it('recomputes the proxy NPS from total promoters and detractors', async () => {
      await setup([
        row({ bucket: '2024-04-01', responses: 90, promoters: 90 }),
        row({ bucket: '2024-05-01', responses: 10, detractors: 10 }),
      ]);
      const result = await monthly();

      // 90 promoters and 10 detractors out of 100.
      expect(result.overallProxyNps).toBe(80);
      expect(result.totalResponses).toBe(100);
    });
  });

  describe('the correlation', () => {
    it('is suppressed below three paired buckets', async () => {
      await setup([
        row({
          bucket: '2024-04-01',
          avgCompositeScore: 70,
          evaluatedSessions: 5,
          responses: 10,
          promoters: 6,
        }),
        row({
          bucket: '2024-05-01',
          avgCompositeScore: 80,
          evaluatedSessions: 5,
          responses: 10,
          promoters: 8,
        }),
      ]);
      const result = await monthly();

      // Two points always correlate at exactly 1 — the most confident-looking
      // number appearing where there is least reason for confidence.
      expect(result.pairedBuckets).toBe(2);
      expect(result.correlation).toBeNull();
    });

    it('reports r over paired buckets once there are enough', async () => {
      const paired = ['2024-03-01', '2024-04-01', '2024-05-01'].map(
        (bucket, i) =>
          row({
            bucket,
            avgCompositeScore: 60 + i * 10,
            evaluatedSessions: 5,
            responses: 10,
            promoters: 5 + i,
          }),
      );
      await setup(paired);
      const result = await monthly();

      expect(result.pairedBuckets).toBe(3);
      // Both series rise together, so r is 1 — and here that is a real finding
      // about three periods rather than an artefact of having two points.
      expect(result.correlation).toBeCloseTo(1, 3);
    });

    it('is null when a series is flat, rather than 0 or 1', async () => {
      const flat = ['2024-03-01', '2024-04-01', '2024-05-01'].map((bucket, i) =>
        row({
          bucket,
          avgCompositeScore: 70,
          evaluatedSessions: 5,
          responses: 10,
          promoters: 5 + i,
        }),
      );
      await setup(flat);
      const result = await monthly();

      expect(result.pairedBuckets).toBe(3);
      expect(result.correlation).toBeNull();
    });

    it('ignores buckets missing either series', async () => {
      await setup([
        row({
          bucket: '2024-03-01',
          avgCompositeScore: 70,
          evaluatedSessions: 5,
        }),
        row({ bucket: '2024-04-01', responses: 10, promoters: 6 }),
      ]);
      const result = await monthly();

      expect(result.pairedBuckets).toBe(0);
      expect(result.correlation).toBeNull();
    });
  });
});
