import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { currentSelfEfficacyInstrument } from 'src/foundational-skills/constants/self-efficacy-instrument.constants';

import { FoundationalSkillsAnalyticsRepository } from '../../repository/foundational-skills-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import { SelfEfficacyAnalyticsRepository } from '../../repository/self-efficacy-analytics.repository';
import {
  SelfEfficacyAnalyticsService,
  buildSelfEfficacyResponse,
} from '../self-efficacy-analytics.service';

const NOW = new Date('2026-10-05T12:00:00Z');

describe('buildSelfEfficacyResponse', () => {
  it('reads "not yet measured" with no answers: counts of 0, numbers null, floors echoed', () => {
    const res = buildSelfEfficacyResponse(
      currentSelfEfficacyInstrument(),
      [],
      [],
      null,
      NOW,
    );
    expect(res).toMatchObject({
      instrumentVersion: 'v1',
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minSpearmanPoints: 30,
      coverage: {
        learnersAsked: 0,
        learnersAnswered: 0,
        responses: 0,
        byTrigger: { ONBOARDING: 0, CUTS: 0, COURSE: 0 },
      },
      confidence: {
        learnersWithTwoOrMore: 0,
        selfDomain: [0, 10],
        levelDomain: [1, 4],
      },
      scoping: { tenantId: null },
      computedAt: NOW.toISOString(),
    });
    expect(res.confidence.tiers.map((t) => [t.tier, t.label])).toEqual([
      ['engage', 'Engage'],
      ['understand', 'Understand'],
      ['support', 'Support'],
    ]);
    expect(res.confidence.tiers[0].self.change).toBeNull();
    expect(res.confidence.skills).toHaveLength(14);
    expect(res.confidence.skills[0]).toMatchObject({
      skill: 'verbal',
      name: 'Verbal communication',
    });
    expect(res.calibration.overall).toMatchObject({
      learners: 0,
      observations: 0,
      overConfidentPct: null,
    });
    expect(res.calibration.thresholds).toEqual({
      rescale: '1 + 3·r/10',
      band: 0.75,
      matchWindowDays: 30,
    });
    expect(res.calibration.safetyFlag).toMatchObject({
      skill: 'harm',
      learners: 0,
      overConfident: 0,
      overConfidentPct: null,
      internal: true,
    });
    expect(res.calibration.points).toEqual([]);
    expect(res.calibration.pointCap).toBe(2000);
  });

  it('carries the self-assessment caveat and names the rulers', () => {
    const res = buildSelfEfficacyResponse(
      currentSelfEfficacyInstrument(),
      [],
      [],
      'tenant-a',
      NOW,
    );
    expect(res.caveat).toContain('over-confident');
    expect(res.caveat).toContain('not yet checked against human raters');
    expect(res.provenance.derivation).toContain('ruler R1');
    expect(res.provenance.derivation).toContain(FHS_RUBRIC_VERSION);
    expect(res.provenance.note).toContain(res.caveat);
    expect(res.scoping.tenantId).toBe('tenant-a');
  });
});

describe('SelfEfficacyAnalyticsService', () => {
  it('reads the current instrument and the pinned rubric, both scoped to the org', async () => {
    const answers = { getAnswers: jest.fn().mockResolvedValue([]) };
    const cuts = { getAllLearnerCuts: jest.fn().mockResolvedValue([]) };
    const service = new SelfEfficacyAnalyticsService(
      answers as unknown as SelfEfficacyAnalyticsRepository,
      cuts as unknown as FoundationalSkillsAnalyticsRepository,
    );

    await service.getSelfEfficacy({ tenantId: 'tenant-a' });
    expect(answers.getAnswers).toHaveBeenCalledWith('v1', 'tenant-a');
    expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'tenant-a',
    );

    await service.getSelfEfficacy({});
    expect(answers.getAnswers).toHaveBeenLastCalledWith('v1', undefined);
    expect(cuts.getAllLearnerCuts).toHaveBeenLastCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
  });
});
