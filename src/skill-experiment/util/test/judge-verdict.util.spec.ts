import { parseJudgeVerdict, weightedScore } from '../judge-verdict.util';
import { RubricCriterion } from '../../type/skill-experiment.type';

const RUBRIC: RubricCriterion[] = [
  { key: 'accuracy', name: 'Accuracy', description: 'Correct', weight: 3 },
  { key: 'tone', name: 'Tone', description: 'Warm', weight: 1 },
];

describe('parseJudgeVerdict', () => {
  it('reads a fenced reply with every criterion', () => {
    const raw =
      '```json\n{"criteria": {"accuracy": {"score": 4, "reason": "mostly"}, ' +
      '"tone": {"score": 5, "reason": "warm"}}, "summary": "good"}\n```';
    expect(parseJudgeVerdict(raw, RUBRIC)).toEqual({
      criteria: {
        accuracy: { score: 4, reason: 'mostly' },
        tone: { score: 5, reason: 'warm' },
      },
      summary: 'good',
    });
  });

  it('throws when a criterion is missing rather than scoring the rest', () => {
    const raw = '{"criteria": {"accuracy": {"score": 4, "reason": "x"}}}';
    expect(() => parseJudgeVerdict(raw, RUBRIC)).toThrow(/"tone"/);
  });

  it('throws on an out-of-range score', () => {
    const raw =
      '{"criteria": {"accuracy": {"score": 9}, "tone": {"score": 3}}}';
    expect(() => parseJudgeVerdict(raw, RUBRIC)).toThrow(/"accuracy"/);
  });

  it('throws on a reply that is not JSON', () => {
    expect(() => parseJudgeVerdict('I think it is fine.', RUBRIC)).toThrow(
      /not a JSON object/,
    );
  });
});

describe('weightedScore', () => {
  it('maps 1–5 to 0–100 and weights by criterion', () => {
    // accuracy 5 → 100 (weight 3), tone 1 → 0 (weight 1) → 75
    expect(
      weightedScore(
        {
          accuracy: { score: 5, reason: '' },
          tone: { score: 1, reason: '' },
        },
        RUBRIC,
      ),
    ).toBe(75);
  });
});
