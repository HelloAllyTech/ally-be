import { readFileSync } from 'fs';
import { join } from 'path';

import {
  FHS_RUBRIC,
  FHS_SKILL_KEYS,
} from '../constants/helping-skills-rubric.constants';
import {
  SELF_EFFICACY_CADENCE,
  SELF_EFFICACY_INSTRUMENT_VERSION,
  SELF_EFFICACY_INSTRUMENT_VERSIONS,
  SELF_EFFICACY_MIN_HOURS_BETWEEN,
  SelfEfficacyInstrument,
  currentSelfEfficacyInstrument,
  selfEfficacyInstrument,
} from '../constants/self-efficacy-instrument.constants';
import { SelfAssessmentTrigger } from '../enum/self-assessment.enum';

describe('self-efficacy instrument v1', () => {
  const v1 = selfEfficacyInstrument('v1') as SelfEfficacyInstrument;

  it('is the current version, built once and memoised', () => {
    expect(SELF_EFFICACY_INSTRUMENT_VERSION).toBe('v1');
    expect(SELF_EFFICACY_INSTRUMENT_VERSIONS).toEqual(['v1']);
    expect(currentSelfEfficacyInstrument()).toBe(v1);
    expect(selfEfficacyInstrument('v9')).toBeNull();
    expect(selfEfficacyInstrument('toString')).toBeNull();
  });

  it('asks one item per rubric skill, in rubric order', () => {
    // Fails when a rubric skill is added or retired: that is a new instrument
    // version, not an edit to v1.
    expect(v1.items.map((i) => i.skill)).toEqual([...FHS_SKILL_KEYS]);
    expect(v1.items).toHaveLength(14);
    for (const item of v1.items) {
      const rubric = FHS_RUBRIC.find((s) => s.key === item.skill);
      expect(item.tier).toBe(rubric?.tier);
      expect(item.name).toBe(rubric?.name);
    }
  });

  it('is a 0–10 confidence scale with labelled ends', () => {
    expect(v1.scale).toEqual({
      min: 0,
      max: 10,
      anchors: { min: 'Not at all confident', max: 'Completely confident' },
    });
  });

  it('keeps the exact v1 wording (a rubric rename must bump the instrument, not reword it)', () => {
    expect(v1.items.map((i) => i.prompt)).toEqual([
      'How confident are you in this skill: Verbal communication?',
      'How confident are you in this skill: Explain and promote confidentiality?',
      'How confident are you in this skill: Rapport-building and self-disclosure?',
      'How confident are you in this skill: Exploration and normalisation of feelings?',
      'How confident are you in this skill: Empathy, warmth and genuineness?',
      'How confident are you in this skill: Assessment of harm and developing a response plan?',
      'How confident are you in this skill: Connect to social functioning and impact on life?',
      "How confident are you in this skill: Explore the client's explanation for the problem?",
      'How confident are you in this skill: Involvement of family and significant others?',
      'How confident are you in this skill: Collaborative goal-setting?',
      'How confident are you in this skill: Promote realistic hope for change?',
      'How confident are you in this skill: Incorporate coping mechanisms and prior solutions?',
      'How confident are you in this skill: Psychoeducation with local terminology?',
      'How confident are you in this skill: Elicitation of feedback?',
    ]);
  });

  it('is asked at onboarding, every 3 scored cuts and on course completion, at most daily', () => {
    expect(SELF_EFFICACY_CADENCE).toEqual({
      everyScoredCuts: 3,
      onCourseCompletion: true,
      onOnboarding: true,
    });
    expect(SELF_EFFICACY_MIN_HOURS_BETWEEN).toBe(24);
  });
});

describe('learner_self_assessments migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../database/migrations/1975710000000-CreateLearnerSelfAssessments.ts',
    ),
    'utf8',
  ).split(/public async down/)[0];

  it('lets the trigger CHECK accept every SelfAssessmentTrigger value', () => {
    const match = sql.match(
      /CONSTRAINT "CHK_learner_self_assessments_trigger" CHECK \("trigger" IN \(([^)]*)\)\)/,
    );
    expect(match).not.toBeNull();
    const allowed = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(allowed.sort()).toEqual(Object.values(SelfAssessmentTrigger).sort());
  });

  it('constrains responses to integers 0–10 in a JSON object', () => {
    expect(sql).toContain(`jsonb_typeof("responses") = 'object'`);
    expect(sql).toContain('@ < 0 || @ > 10 || @ != @.floor()');
  });
});
