import { ForbiddenException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { TrackProgressDashboardService } from '../track-progress-dashboard.service';

describe('TrackProgressDashboardService.getDashboard', () => {
  const TRACK_ID = 'track-1';
  const ENROLLMENT_ID = 'enr-1';
  const USER_ID = 7;

  const trackEnrollmentRepository = { findByTrackAndUser: jest.fn() };
  const trackItemProgressRepository = { findByEnrollmentId: jest.fn() };
  const trackSharedService = { getTrackWithStructure: jest.fn() };
  const trackProgressDashboardRepository = { getRoleplayFeedback: jest.fn() };

  const service = new TrackProgressDashboardService(
    trackEnrollmentRepository as any,
    trackItemProgressRepository as any,
    trackSharedService as any,
    trackProgressDashboardRepository as any,
  );

  const structure = {
    id: TRACK_ID,
    title: 'De-escalation Basics',
    totalItems: 2,
    sections: [
      {
        id: 'sec-1',
        title: 'Section 1',
        order: 1,
        items: [{ id: 'item-1' }, { id: 'item-2' }],
      },
    ],
  };

  const enrollment = {
    id: ENROLLMENT_ID,
    completedItems: 1,
    startedAt: new Date('2026-08-01T00:00:00.000Z'),
    completedAt: null,
    lastActivityAt: new Date('2026-08-05T00:00:00.000Z'),
  };

  const roleplayRow = (
    overrides: Partial<{
      compositeScore: number | null;
      skillCoverage: { category: string; percentage: number }[] | null;
      evaluationMarkdown: string | null;
    }> = {},
  ) => ({
    trackItemId: 'item-1',
    trackItemTitle: 'Practice: an upset client',
    scenarioSessionId: 'sess-1',
    compositeScore: 80,
    occurredAt: '2026-08-02T00:00:00.000Z',
    skillCoverage: [{ category: 'Listening Engagement', percentage: 80 }],
    evaluationMarkdown: '## What worked\nGood rapport building.',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(String(USER_ID));
    trackSharedService.getTrackWithStructure.mockResolvedValue(structure);
    trackEnrollmentRepository.findByTrackAndUser.mockResolvedValue(enrollment);
    trackItemProgressRepository.findByEnrollmentId.mockResolvedValue([
      { trackItemId: 'item-1', status: 'COMPLETED' },
      { trackItemId: 'item-2', status: 'UNLOCKED' },
    ]);
    trackProgressDashboardRepository.getRoleplayFeedback.mockResolvedValue([]);
  });

  it('throws when the learner is not enrolled', async () => {
    trackEnrollmentRepository.findByTrackAndUser.mockResolvedValue(null);

    await expect(service.getDashboard(TRACK_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('computes completionPct and per-section rollup from progress rows', async () => {
    const result = await service.getDashboard(TRACK_ID);

    expect(result.completionPct).toBe(50);
    expect(result.sections).toEqual([
      {
        id: 'sec-1',
        title: 'Section 1',
        order: 1,
        completedItems: 1,
        totalItems: 2,
      },
    ]);
  });

  it('reports zero completion without dividing by zero when the course has no items', async () => {
    trackSharedService.getTrackWithStructure.mockResolvedValue({
      ...structure,
      totalItems: 0,
      sections: [],
    });

    const result = await service.getDashboard(TRACK_ID);

    expect(result.completionPct).toBe(0);
  });

  it('returns empty feedback with no divide-by-zero when no roleplay item has been evaluated yet', async () => {
    const result = await service.getDashboard(TRACK_ID);

    expect(result.evaluatedRoleplaySessionCount).toBe(0);
    expect(result.averageCompositeScore).toBeNull();
    expect(result.skillCategories).toEqual([]);
    expect(result.roleplaySessions).toEqual([]);
  });

  it('classifies a category as insufficient_data below the minimum sample size, regardless of score', async () => {
    trackProgressDashboardRepository.getRoleplayFeedback.mockResolvedValue([
      roleplayRow({
        skillCoverage: [{ category: 'Listening Engagement', percentage: 95 }],
      }),
    ]);

    const result = await service.getDashboard(TRACK_ID);

    expect(result.skillCategories).toEqual([
      {
        category: 'Listening Engagement',
        averagePercentage: 95,
        sampleSize: 1,
        classification: 'insufficient_data',
      },
    ]);
  });

  it('classifies demonstrated vs needs_practice at the 70% line once sample size is met', async () => {
    trackProgressDashboardRepository.getRoleplayFeedback.mockResolvedValue([
      roleplayRow({
        skillCoverage: [
          { category: 'Listening Engagement', percentage: 90 },
          { category: 'Emotional Attunement', percentage: 40 },
        ],
      }),
      roleplayRow({
        skillCoverage: [
          { category: 'Listening Engagement', percentage: 70 },
          { category: 'Emotional Attunement', percentage: 60 },
        ],
      }),
    ]);

    const result = await service.getDashboard(TRACK_ID);

    const byCategory = Object.fromEntries(
      result.skillCategories.map((c) => [c.category, c]),
    );
    expect(byCategory['Listening Engagement']).toMatchObject({
      averagePercentage: 80,
      sampleSize: 2,
      classification: 'demonstrated',
    });
    expect(byCategory['Emotional Attunement']).toMatchObject({
      averagePercentage: 50,
      sampleSize: 2,
      classification: 'needs_practice',
    });
  });

  it('keeps mixed skillCoverage label generations as separate, unmerged categories', async () => {
    trackProgressDashboardRepository.getRoleplayFeedback.mockResolvedValue([
      roleplayRow({
        skillCoverage: [{ category: 'Listening Engagement', percentage: 80 }],
      }),
      roleplayRow({
        skillCoverage: [{ category: 'Learning', percentage: 80 }],
      }),
    ]);

    const result = await service.getDashboard(TRACK_ID);

    expect(result.skillCategories.map((c) => c.category).sort()).toEqual([
      'Learning',
      'Listening Engagement',
    ]);
    expect(result.skillCategories.every((c) => c.sampleSize === 1)).toBe(true);
  });

  it('averages compositeScore across evaluated roleplay sessions', async () => {
    trackProgressDashboardRepository.getRoleplayFeedback.mockResolvedValue([
      roleplayRow({ compositeScore: 80 }),
      roleplayRow({ compositeScore: 60 }),
    ]);

    const result = await service.getDashboard(TRACK_ID);

    expect(result.evaluatedRoleplaySessionCount).toBe(2);
    expect(result.averageCompositeScore).toBe(70);
  });

  it('passes evaluationMarkdown through per session, including null', async () => {
    trackProgressDashboardRepository.getRoleplayFeedback.mockResolvedValue([
      roleplayRow({ evaluationMarkdown: 'Great work on rapport.' }),
      roleplayRow({ evaluationMarkdown: null }),
    ]);

    const result = await service.getDashboard(TRACK_ID);

    expect(result.roleplaySessions.map((s) => s.evaluationMarkdown)).toEqual([
      'Great work on rapport.',
      null,
    ]);
  });
});
