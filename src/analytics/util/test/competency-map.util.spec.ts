import type { CompetencyMapRow } from '../../repository/competency-map-analytics.repository';
import type { FoundationalSkillsLearnerCutRow } from '../../repository/foundational-skills-analytics.repository';
import {
  buildCompetencyScores,
  competencySkill,
  singleScenarioOf,
} from '../competency-map.util';

const EMPATHY = 'c-empathy';
const NON_VERBAL = 'c-nonverbal';
const CUSTOM = 'c-custom';

const volume: CompetencyMapRow[] = [
  {
    competencyId: EMPATHY,
    name: 'Empathy, Warmth & Genuineness',
    completedSessions: 120,
    learners: 30,
    scenarios: 3,
  },
  {
    competencyId: NON_VERBAL,
    name: 'Non-Verbal Communication',
    completedSessions: 80,
    learners: 20,
    scenarios: 2,
  },
  {
    competencyId: CUSTOM,
    name: 'Our house de-escalation style',
    completedSessions: 10,
    learners: 4,
    scenarios: 1,
  },
];

/** Session id → scenario id: s1x on scenario 1, s2x on 2, s9x on 9 (untagged). */
const sessionScenario = new Map<string, { scenarioId: number | null }>([
  ['s1a', { scenarioId: 1 }],
  ['s1b', { scenarioId: 1 }],
  ['s2a', { scenarioId: 2 }],
  ['s9a', { scenarioId: 9 }],
  ['sNull', { scenarioId: null }],
]);
const scenarioTags = new Map<number, string[]>([
  [1, [EMPATHY, NON_VERBAL]],
  [2, [EMPATHY]],
]);

let nextCut = 0;
const cut = (
  userId: number,
  sessionIds: string[],
  levels: Record<string, number>,
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: null,
  tenantId: 'org-a',
  cut: (nextCut += 1),
  closedAt: new Date('2026-08-01T00:00:00Z'),
  score: 2.5,
  unhelpful: false,
  levels,
  verdicts: [],
  sessionIds,
});

describe('singleScenarioOf', () => {
  it('returns the one scenario every session ran', () => {
    expect(singleScenarioOf(['s1a', 's1b'], sessionScenario)).toBe(1);
    expect(singleScenarioOf(['s2a'], sessionScenario)).toBe(2);
  });

  it('is null for a cut spanning scenarios, an unknown session, or no sessions', () => {
    expect(singleScenarioOf(['s1a', 's2a'], sessionScenario)).toBeNull();
    expect(singleScenarioOf(['s1a', 'missing'], sessionScenario)).toBeNull();
    expect(singleScenarioOf(['sNull'], sessionScenario)).toBeNull();
    expect(singleScenarioOf([], sessionScenario)).toBeNull();
  });
});

describe('competencySkill', () => {
  it('maps seeded names exactly and leaves the deliberate gaps unmapped', () => {
    expect(competencySkill('Empathy, Warmth & Genuineness')).toBe('empathy');
    expect(competencySkill('Non-Verbal Communication')).toBeNull();
    expect(
      competencySkill('Linking Emotions, Thoughts & Behaviours'),
    ).toBeNull();
    expect(competencySkill('empathy, warmth & genuineness')).toBeNull();
  });
});

describe('buildCompetencyScores', () => {
  const cuts = [
    // Single-scenario, scenario 1 (tagged empathy + non-verbal), assessable.
    cut(1, ['s1a', 's1b'], { empathy: 3 }),
    cut(2, ['s1a'], { empathy: 2 }),
    // Single-scenario, scenario 2 (tagged empathy), assessable.
    cut(2, ['s2a'], { empathy: 4 }),
    // Single-scenario on an empathy scenario but NO empathy opportunity.
    cut(3, ['s2a'], { rapport: 2 }),
    // Spans scenarios 1 and 2: credited to neither, even though both are tagged.
    cut(3, ['s1a', 's2a'], { empathy: 1 }),
    // Single-scenario on an untagged scenario.
    cut(4, ['s9a'], { empathy: 1 }),
  ];

  it('scores the tag’s own skill over assessable single-scenario cuts only', () => {
    const { rows } = buildCompetencyScores(
      volume,
      cuts,
      sessionScenario,
      scenarioTags,
      3,
    );
    const empathy = rows.find((r) => r.competencyId === EMPATHY);
    expect(empathy).toMatchObject({
      skill: 'empathy',
      skillName: expect.any(String),
      // (3 + 2 + 4) / 3 — the spanning cut's 1 and the untagged cut's 1 are out.
      score: 3,
      taggedCuts: 4,
      scoredCuts: 3,
      scoreLearners: 2,
      scoreUnavailable: null,
      // The volume axis passes through untouched.
      completedSessions: 120,
      learners: 30,
      scenarios: 3,
    });
  });

  it('withholds a score below the floor but keeps every count', () => {
    const { rows } = buildCompetencyScores(
      volume,
      cuts,
      sessionScenario,
      scenarioTags,
      4,
    );
    const empathy = rows.find((r) => r.competencyId === EMPATHY);
    expect(empathy).toMatchObject({
      score: null,
      scoreUnavailable: 'tooFewCuts',
      scoredCuts: 3,
      taggedCuts: 4,
    });
  });

  it('gives a tag with no rubric skill its volume and a reason, not a thin-sample flag', () => {
    const { rows } = buildCompetencyScores(
      volume,
      cuts,
      sessionScenario,
      scenarioTags,
      1,
    );
    for (const id of [NON_VERBAL, CUSTOM]) {
      expect(rows.find((r) => r.competencyId === id)).toMatchObject({
        skill: null,
        score: null,
        scoreUnavailable: 'noRubricSkill',
        scoredCuts: 0,
        taggedCuts: 0,
      });
    }
    expect(rows.find((r) => r.competencyId === NON_VERBAL)).toMatchObject({
      completedSessions: 80,
    });
  });

  it('reports how much of the ruler is attributable, floored as a rate', () => {
    const shown = buildCompetencyScores(
      volume,
      cuts,
      sessionScenario,
      scenarioTags,
      5,
    ).cutAttribution;
    expect(shown).toEqual({
      scoredCuts: 6,
      singleScenarioCuts: 5,
      singleScenarioPct: 83.3,
      untaggedCuts: 1,
    });

    const thin = buildCompetencyScores(
      volume,
      cuts,
      sessionScenario,
      scenarioTags,
      7,
    ).cutAttribution;
    expect(thin.singleScenarioPct).toBeNull();
    expect(thin.singleScenarioCuts).toBe(5);
  });

  it('never returns a 0% share over no cuts', () => {
    const { cutAttribution, rows } = buildCompetencyScores(
      volume,
      [],
      sessionScenario,
      scenarioTags,
      0,
    );
    expect(cutAttribution.singleScenarioPct).toBeNull();
    expect(rows.find((r) => r.competencyId === EMPATHY)?.score).toBeNull();
  });
});
