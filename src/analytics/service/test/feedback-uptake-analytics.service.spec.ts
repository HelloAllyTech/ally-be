import { FEEDBACK_SKILL_MAPPER_VERSION } from 'src/foundational-skills/constants/feedback-skill-mapper.constants';
import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FEEDBACK_UPTAKE_CAVEAT,
  FeedbackUptakeAnalyticsService,
  buildFeedbackUptakeResponse,
} from '../feedback-uptake-analytics.service';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';

const coverage = { debriefed: 5, mapped: 3, skipped: 1, failed: 0, pending: 1 };
const at = (d: number) => new Date(Date.UTC(2026, 8, d, 12));

describe('buildFeedbackUptakeResponse', () => {
  it('counts improvements and the ones filed under no skill, and echoes versions and floor', () => {
    const response = buildFeedbackUptakeResponse({
      sessions: [
        {
          sessionId: 's1',
          userId: 1,
          endedAt: at(4),
          items: [
            { index: 0, skill: 'feelings' },
            { index: 1, skill: null },
            { index: 2, skill: 'feelings' },
          ],
        },
      ],
      // Out of order on purpose: the build sorts each learner's cuts.
      cuts: [
        {
          userId: 1,
          cutIndex: 2,
          closedAt: at(8),
          firstEndedAt: at(6),
          levels: { feelings: 2 },
        },
        {
          userId: 1,
          cutIndex: 1,
          closedAt: at(2),
          firstEndedAt: at(1),
          levels: { feelings: 1 },
        },
      ],
      coverage,
      tenantId: null,
      floor: 20,
      now: new Date('2026-10-05T00:00:00Z'),
    });

    expect(response).toMatchObject({
      rubricVersion: FHS_RUBRIC_VERSION,
      mapperVersion: FEEDBACK_SKILL_MAPPER_VERSION,
      minSampleSize: 20,
      coverage: {
        debriefedSessions: 5,
        mappedSessions: 3,
        skippedSessions: 1,
        failedSessions: 0,
        pendingSessions: 1,
        improvements: 3,
        improvementsWithoutSkill: 1,
        sessionsPaired: 1,
        windows: 1,
        learnersPaired: 1,
        namedNotAssessable: 0,
      },
      caveat: FEEDBACK_UPTAKE_CAVEAT,
      scoping: { tenantId: null },
      computedAt: '2026-10-05T00:00:00.000Z',
    });
    const feelings = response.skills.find((s) => s.skill === 'feelings')!;
    // One window, named once however many items named it; below the floor.
    expect(feelings.named).toMatchObject({
      learners: 1,
      observations: 1,
      rosePct: null,
    });
    expect(response.provenance.derivation).toContain('R1');
    expect(response.provenance.derivation).toContain(FHS_RUBRIC_VERSION);
    expect(response.caveat).toContain('regression to the mean');
  });

  it('says how the org filter reaches sessions and cuts when an org is picked', () => {
    const response = buildFeedbackUptakeResponse({
      sessions: [],
      cuts: [],
      coverage,
      tenantId: 'org-1',
      floor: 20,
    });
    expect(response.scoping.tenantId).toBe('org-1');
    expect(response.scoping.note).toMatch(
      /Sessions by their own org; cuts by the org/,
    );
  });
});

describe('FeedbackUptakeAnalyticsService', () => {
  it('reads the pinned versions with the org filter and applies the platform floor', async () => {
    const repository = {
      getMappedSessions: jest.fn().mockResolvedValue([]),
      getScoredCuts: jest.fn().mockResolvedValue([]),
      getCoverage: jest.fn().mockResolvedValue(coverage),
    };
    const service = new FeedbackUptakeAnalyticsService(repository as any);

    const response = await service.getFeedbackUptake({ tenantId: 'org-1' });

    expect(repository.getMappedSessions).toHaveBeenCalledWith(
      FEEDBACK_SKILL_MAPPER_VERSION,
      'org-1',
    );
    expect(repository.getScoredCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      FEEDBACK_SKILL_MAPPER_VERSION,
      'org-1',
    );
    expect(repository.getCoverage).toHaveBeenCalledWith(
      FEEDBACK_SKILL_MAPPER_VERSION,
      FHS_RUBRIC_VERSION,
      'org-1',
    );
    expect(response.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(response.skills).toHaveLength(14);
  });

  it('treats an empty tenantId as every non-test org', async () => {
    const repository = {
      getMappedSessions: jest.fn().mockResolvedValue([]),
      getScoredCuts: jest.fn().mockResolvedValue([]),
      getCoverage: jest.fn().mockResolvedValue(coverage),
    };
    const response = await new FeedbackUptakeAnalyticsService(
      repository as any,
    ).getFeedbackUptake({ tenantId: '' });

    expect(repository.getMappedSessions).toHaveBeenCalledWith(
      FEEDBACK_SKILL_MAPPER_VERSION,
      undefined,
    );
    expect(response.scoping.tenantId).toBeNull();
  });
});
