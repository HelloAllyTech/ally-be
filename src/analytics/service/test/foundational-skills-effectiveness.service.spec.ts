import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FoundationalSkillsAnalyticsRepository,
  FoundationalSkillsLearnerCutRow,
} from '../../repository/foundational-skills-analytics.repository';
import { FoundationalSkillsEffectivenessRepository } from '../../repository/foundational-skills-effectiveness.repository';
import { FoundationalSkillsEffectivenessService } from '../foundational-skills-effectiveness.service';

/** The glue: same cut read as the rest of the tab, scope and floors echoed. */
const row = (
  userId: number,
  cut: number,
  levels: Record<string, number>,
  sessionIds: string[],
  score = 2.5,
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: 'not returned',
  tenantId: 't-1',
  cut,
  closedAt: new Date('2026-01-01T00:00:00Z'),
  score,
  unhelpful: false,
  levels,
  verdicts: [],
  sessionIds,
});

const build = (rows: FoundationalSkillsLearnerCutRow[] = []) => {
  const cuts = {
    getAllLearnerCuts: jest.fn().mockResolvedValue(rows),
  } as unknown as jest.Mocked<FoundationalSkillsAnalyticsRepository>;
  const repository = {
    getPracticeMinutesToCuts: jest.fn().mockResolvedValue(new Map()),
    getSessionTimes: jest.fn().mockResolvedValue(new Map()),
    getPracticeOrdinals: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<FoundationalSkillsEffectivenessRepository>;
  return {
    cuts,
    repository,
    service: new FoundationalSkillsEffectivenessService(cuts, repository),
  };
};

describe('FoundationalSkillsEffectivenessService', () => {
  it('time to competence: reads the pinned cut set in scope and looks up minutes for reachers only', async () => {
    const { cuts, repository, service } = build([
      row(1, 1, { goals: 3, hope: 3 }, ['s1']),
      row(2, 1, { goals: 2 }, ['s2']),
    ]);
    const out = await service.getTimeToCompetence({ tenantId: 'acme' });

    expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'acme',
    );
    expect(repository.getPracticeMinutesToCuts).toHaveBeenCalledWith(
      [{ userId: 1, cut: 1 }],
      'acme',
    );
    expect(out.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    expect(out.minSampleSize).toBe(20);
    expect(out.minCohortSize).toBe(5);
    expect(out.tierCompetenceSkills).toEqual({
      engage: 2,
      understand: 3,
      support: 2,
    });
    expect(out.excludedSkills.map((s) => s.skill).sort()).toEqual([
      'confidentiality',
      'family',
      'harm',
      'rapport',
    ]);
    expect(out.scoping).toEqual({ tenantId: 'acme', unscopedSections: [] });
    expect(out.learners).toBe(2);
    expect(out.tiers).toHaveLength(3);
    expect(out.provenance.derivation).toContain('R1');
    expect(out.provenance.derivation).toContain(
      'Engage 2 of 3, Understand 3 of 4, Support 2 of 3',
    );
    expect(JSON.stringify(out)).not.toContain('not returned');
  });

  it('retention: loads session times for every cut session in one read', async () => {
    const { repository, service } = build([
      row(1, 1, {}, ['a', 'b']),
      row(1, 2, {}, ['b', 'c']),
    ]);
    const out = await service.getRetention();
    expect(repository.getSessionTimes).toHaveBeenCalledTimes(1);
    expect(repository.getSessionTimes).toHaveBeenCalledWith([
      'a',
      'b',
      'b',
      'c',
    ]);
    expect(out.minPairs).toBe(20);
    expect(out.minLearners).toBe(10);
    expect(out.bandDefs.map((b) => b.band)).toEqual([
      '<7',
      '7-13',
      '14-29',
      '30+',
    ]);
    // No times came back: the pair is counted, not plotted.
    expect(out.pairs.missingTimes).toBe(1);
    expect(out.scoping.tenantId).toBeNull();
  });

  it('practice progression: twelve ordinals, all-time, scoped', async () => {
    const { repository, service } = build();
    const out = await service.getPracticeProgression({ tenantId: 'acme' });
    expect(repository.getPracticeOrdinals).toHaveBeenCalledWith(12, 'acme');
    expect(out.maxOrdinal).toBe(12);
    expect(out.experiencedMinSessions).toBe(12);
    expect(out.levels).toEqual(['EASY', 'MEDIUM', 'HARD', 'untagged']);
    expect(out.ordinals).toHaveLength(12);
    expect(out.provenance.note).toContain('authoring label');
  });
});
