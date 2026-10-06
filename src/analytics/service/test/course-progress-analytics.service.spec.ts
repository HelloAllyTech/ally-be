import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { CourseProgressAnalyticsRepository } from '../../repository/course-progress-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import {
  MIN_POINTS_FOR_CORRELATION,
  PROGRESS_CURVE_CHART_COURSES,
} from '../../util/course-progress-analytics.util';
import {
  CourseProgressAnalyticsService,
  KNOWLEDGE_SKILL_WINDOW_CUTS,
} from '../course-progress-analytics.service';

const repositoryMock = () => ({
  getLiveTrackItems: jest.fn().mockResolvedValue([]),
  getProgressEnrollments: jest.fn().mockResolvedValue([]),
  getQuizCourseEnrollments: jest.fn().mockResolvedValue([]),
  getFirstQuizAttempts: jest.fn().mockResolvedValue([]),
  getScoredCuts: jest.fn().mockResolvedValue([]),
});

describe('CourseProgressAnalyticsService', () => {
  it('progress curve: echoes the floor, names R10 and passes the tenant through', async () => {
    const repo = repositoryMock();
    const service = new CourseProgressAnalyticsService(
      repo as unknown as CourseProgressAnalyticsRepository,
    );
    const res = await service.getProgressCurve({ tenantId: 'org-1' });

    expect(repo.getProgressEnrollments).toHaveBeenCalledWith('org-1');
    expect(res).toMatchObject({
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      chartCourses: PROGRESS_CURVE_CHART_COURSES,
      courses: [],
      others: [],
      belowFloor: [],
      scoping: { tenantId: 'org-1', unscopedSections: [] },
    });
    expect(res.provenance.derivation).toContain('R10');
    expect(res.provenance.note).toContain('unlocked, not opened');
    expect(Number.isNaN(Date.parse(res.computedAt))).toBe(false);
  });

  it('knowledge vs skill: pins the rubric, echoes the 30-point floor, platform-wide by default', async () => {
    const repo = repositoryMock();
    const service = new CourseProgressAnalyticsService(
      repo as unknown as CourseProgressAnalyticsRepository,
    );
    const res = await service.getKnowledgeVsSkill();

    expect(repo.getScoredCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
    expect(res).toMatchObject({
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_POINTS_FOR_CORRELATION,
      scoreDomain: [1, 4],
      quizScoreDomain: [0, 100],
      skillWindowCuts: KNOWLEDGE_SKILL_WINDOW_CUTS,
      points: [],
      courses: [],
      overall: { points: 0, r: null, rCi: null, detectable: false },
      scoping: { tenantId: null, unscopedSections: [] },
    });
    expect(MIN_POINTS_FOR_CORRELATION).toBe(30);
    expect(res.provenance.derivation).toContain('R5 × R1');
    expect(res.provenance.note).toContain('weak r is expected');
  });
});
