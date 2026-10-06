import { Test, TestingModule } from '@nestjs/testing';

import {
  PracticeDepthAnalyticsService,
  SPACING_BANDS,
  SPACING_TARGET_DAYS,
  buildPracticeSpacing,
} from '../practice-depth-analytics.service';
import {
  MIN_STICKINESS_POPULATION,
  PracticeDepthAnalyticsRepository,
  SessionGapRow,
} from '../../repository/practice-depth-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';

const row = (userId: number, gaps: number[]): SessionGapRow => ({
  userId,
  sessions: gaps.length + 1,
  gaps,
});

describe('practice spacing (AAQ-224)', () => {
  describe('buildPracticeSpacing', () => {
    it('bands every gap at the right edges', () => {
      // One gap at each edge, repeated so the shares clear the floor.
      const edges = [0, 1, 2, 6, 7, 13, 14, 29, 30, 365];
      const rows = [row(1, edges), row(2, edges)];
      const out = buildPracticeSpacing(rows, { gapFloor: 20 });

      expect(out.window).toBe('all');
      expect(out.totalGaps).toBe(20);
      expect(out.bands.map((b) => [b.band, b.gaps, b.learners])).toEqual([
        ['0-1', 4, 2],
        ['2-6', 4, 2],
        ['7-13', 4, 2],
        ['14-29', 4, 2],
        ['30+', 4, 2],
      ]);
      expect(out.bands.map((b) => b.sharePct)).toEqual([20, 20, 20, 20, 20]);
      expect(out.bands.map((b) => b.label)).toEqual(
        SPACING_BANDS.map((b) => b.label),
      );
      expect(out.bands[4].maxDays).toBeNull();
    });

    it('withholds the shares below the gap floor but keeps the counts', () => {
      const out = buildPracticeSpacing([row(1, [0, 3, 8])]);
      expect(out.minGapSample).toBe(MIN_SCORE_SAMPLE_SIZE);
      expect(out.totalGaps).toBe(3);
      expect(out.bands.map((b) => b.gaps)).toEqual([1, 1, 1, 0, 0]);
      expect(out.bands.every((b) => b.sharePct === null)).toBe(true);
    });

    it('gives each learner one vote on the KPI, by their MEDIAN gap', () => {
      const rows = [
        row(1, [1, 2, 3]), // median 2 → within a week
        row(2, [0, 0, 0, 0, 0, 0, 40]), // median 0 → within (heavy, massed)
        row(3, [10, 20]), // median 15 → not
        row(4, [7, 8]), // median 7.5 → not
        row(5, [7]), // median 7 → within (the edge is inclusive)
      ];
      const out = buildPracticeSpacing(rows);
      expect(SPACING_TARGET_DAYS).toBe(7);
      expect(out.activeLearners).toBe(5);
      expect(out.learnersWithinTarget).toBe(3);
      expect(out.withinTargetPct).toBe(60);
      // Learner medians 2, 0, 15, 7.5, 7 → 7.
      expect(out.medianGapDays).toBe(7);
    });

    it('needs two sessions to be active, and the privacy floor for the KPI', () => {
      const rows = [
        row(1, [1]),
        row(2, [2]),
        row(3, [3]),
        row(4, [4]),
        { userId: 5, sessions: 1, gaps: [] },
      ];
      const out = buildPracticeSpacing(rows);
      expect(out.learnersWithSessions).toBe(5);
      expect(out.activeLearners).toBe(4);
      expect(out.minLearners).toBe(MIN_STICKINESS_POPULATION);
      expect(out.learnersWithinTarget).toBe(4);
      expect(out.withinTargetPct).toBeNull();
      expect(out.medianGapDays).toBeNull();
    });

    it('reports nothing as 0% on an empty platform', () => {
      const out = buildPracticeSpacing([]);
      expect(out).toMatchObject({
        totalGaps: 0,
        activeLearners: 0,
        learnersWithinTarget: 0,
        withinTargetPct: null,
        medianGapDays: null,
      });
      expect(out.bands.every((b) => b.gaps === 0 && b.sharePct === null)).toBe(
        true,
      );
      expect(out.provenance.note).toContain('does not');
    });
  });

  describe('PracticeDepthAnalyticsService.getStickiness', () => {
    const setup = async (gapRows: SessionGapRow[]) => {
      const repo = {
        getActiveDayHistogram: jest
          .fn()
          .mockResolvedValue([{ activeDays: 1, learners: 10 }]),
        getSessionGaps: jest.fn().mockResolvedValue(gapRows),
        getQualifiedSessionsByBucket: jest.fn(),
        getDataFloor: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PracticeDepthAnalyticsService,
          { provide: PracticeDepthAnalyticsRepository, useValue: repo },
        ],
      }).compile();
      return { repo, service: module.get(PracticeDepthAnalyticsService) };
    };

    it('adds the spacing block beside the unchanged funnel, with the same tenant', async () => {
      const { repo, service } = await setup([row(1, [3]), row(2, [9])]);
      const res = await service.getStickiness({ tenantId: ' ally ' });

      expect(repo.getActiveDayHistogram).toHaveBeenCalledWith('ally');
      expect(repo.getSessionGaps).toHaveBeenCalledWith('ally');
      expect(res.steps[0].learners).toBe(10);
      expect(res.spacing).toMatchObject({
        window: 'all',
        totalGaps: 2,
        activeLearners: 2,
      });
      expect(res.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
    });
  });
});
