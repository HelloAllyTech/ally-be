import { Test, TestingModule } from '@nestjs/testing';

import {
  QualityDistributionAnalyticsService,
  SATISFACTION_EXPERIENCED_MIN_RATINGS,
  SATISFACTION_MAX_ORDINAL,
  buildSatisfactionByOrdinal,
} from '../quality-distribution-analytics.service';
import {
  MIN_SCORE_SAMPLE_SIZE,
  QualityDistributionAnalyticsRepository,
  RatingOrdinalRow,
} from '../../repository/quality-distribution-analytics.repository';

const r = (
  ordinal: number,
  experienced: boolean,
  ratings: number,
  ratingSum: number,
  high: number,
): RatingOrdinalRow => ({ ordinal, experienced, ratings, ratingSum, high });

describe('satisfaction by practice ordinal (AAQ-229)', () => {
  describe('buildSatisfactionByOrdinal', () => {
    it('serves a contiguous 1..12 axis with zero counts and null values where nobody reached', () => {
      const out = buildSatisfactionByOrdinal([]);
      expect(SATISFACTION_MAX_ORDINAL).toBe(12);
      expect(out.window).toBe('all');
      expect(out.points.map((p) => p.ordinal)).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
      expect(out.points[5].all).toEqual({
        ratings: 0,
        avgRating: null,
        highSharePct: null,
      });
      expect(out.ratedLearners).toBe(0);
      expect(out.ratingsBeyondLastOrdinal).toBe(0);
    });

    it('adds both panel halves for all-comers and keeps the experienced panel apart', () => {
      const out = buildSatisfactionByOrdinal([
        r(1, false, 30, 105, 18), // 30 ratings averaging 3.5, 18 high
        r(1, true, 10, 45, 9), // 10 ratings averaging 4.5, 9 high
      ]);
      expect(out.points[0].all).toEqual({
        ratings: 40,
        avgRating: 3.75,
        highSharePct: 67.5,
      });
      // 10 ratings: below the floor of 20 → values withheld, count kept.
      expect(out.points[0].experienced).toEqual({
        ratings: 10,
        avgRating: null,
        highSharePct: null,
      });
      expect(out.ratedLearners).toBe(40);
      expect(out.experiencedLearners).toBe(10);
      expect(out.experiencedMinRatings).toBe(
        SATISFACTION_EXPERIENCED_MIN_RATINGS,
      );
    });

    it('withholds a cell below the floor and states it from the floor up', () => {
      const out = buildSatisfactionByOrdinal([
        r(2, false, MIN_SCORE_SAMPLE_SIZE - 1, 76, 10),
        r(3, false, MIN_SCORE_SAMPLE_SIZE, 83, 13),
      ]);
      expect(out.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
      expect(out.points[1].all.avgRating).toBeNull();
      expect(out.points[1].all.ratings).toBe(19);
      expect(out.points[2].all).toEqual({
        ratings: 20,
        avgRating: 4.15,
        highSharePct: 65,
      });
    });

    it('counts the pooled tail without plotting it', () => {
      const out = buildSatisfactionByOrdinal([
        r(12, true, 4, 16, 3),
        r(13, true, 9, 40, 8),
        r(13, false, 2, 6, 0),
      ]);
      expect(out.points).toHaveLength(12);
      expect(out.points[11].all.ratings).toBe(4);
      expect(out.ratingsBeyondLastOrdinal).toBe(11);
    });

    it('names the ruler and the survivorship caveat', () => {
      const out = buildSatisfactionByOrdinal([]);
      expect(out.provenance.derivation).toContain('R6');
      expect(out.provenance.note).toContain('experienced');
    });
  });

  describe('QualityDistributionAnalyticsService.getQualityDistribution', () => {
    it('reads the ordinal block all-time — with the tenant, never the window', async () => {
      const repo = {
        getDataFloor: jest.fn().mockResolvedValue(new Date('2024-04-01')),
        getQualityByBucket: jest.fn().mockResolvedValue([]),
        getQualityOverall: jest.fn().mockResolvedValue({
          median: null,
          p25: null,
          p75: null,
          evaluatedSessions: 0,
        }),
        getSatisfactionByBucket: jest.fn().mockResolvedValue([]),
        getSatisfactionOverall: jest.fn().mockResolvedValue({
          low: 0,
          mid: 0,
          high: 0,
          responses: 0,
          ratingSum: 0,
        }),
        getCompletedSessionsByBucket: jest.fn().mockResolvedValue([]),
        getCompletedSessionsOverall: jest.fn().mockResolvedValue(0),
        getLowRatingTags: jest
          .fn()
          .mockResolvedValue({ tags: [], taggedResponses: 0 }),
        getRatingsByOrdinal: jest
          .fn()
          .mockResolvedValue([r(1, false, 25, 100, 20)]),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          QualityDistributionAnalyticsService,
          { provide: QualityDistributionAnalyticsRepository, useValue: repo },
        ],
      }).compile();
      const service = module.get(QualityDistributionAnalyticsService);

      const res = await service.getQualityDistribution({
        range: '30d',
        tenantId: ' ally ',
      });

      expect(repo.getRatingsByOrdinal).toHaveBeenCalledWith(
        SATISFACTION_MAX_ORDINAL,
        SATISFACTION_EXPERIENCED_MIN_RATINGS,
        'ally',
      );
      // The rest of the endpoint still follows its window.
      expect(res.window.allTime).toBe(false);
      expect(res.byOrdinal.window).toBe('all');
      expect(res.byOrdinal.points[0].all).toEqual({
        ratings: 25,
        avgRating: 4,
        highSharePct: 80,
      });
    });
  });
});
