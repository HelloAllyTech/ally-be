import {
  FHS_BEHAVIOURS_BY_CODE,
  FHS_RUBRIC,
  FHS_SKILL_KEYS,
} from '../constants/helping-skills-rubric.constants';
import {
  NumberedLine,
  compositeOf,
  deriveLevel,
  normaliseForMatch,
  parseJudgeReply,
  validateJudgement,
} from '../util/skill-scoring.util';

const skill = (key: string) => FHS_RUBRIC.find((s) => s.key === key)!;
const set = (...codes: string[]) => new Set(codes);

describe('foundational helping skills rubric', () => {
  it('covers the 14 text-assessable skills and no non-verbal one', () => {
    expect(FHS_SKILL_KEYS).toEqual([
      'verbal',
      'confidentiality',
      'rapport',
      'feelings',
      'empathy',
      'harm',
      'functioning',
      'explanation',
      'family',
      'goals',
      'hope',
      'coping',
      'psychoeducation',
      'feedback',
    ]);
  });

  it('uses unique codes that name their own skill and column', () => {
    const codes = FHS_RUBRIC.flatMap((s) =>
      [...s.unhelpful, ...s.basic, ...s.advanced].map((b) => b.code),
    );
    expect(new Set(codes).size).toBe(codes.length);
    for (const [code, b] of FHS_BEHAVIOURS_BY_CODE) {
      const letter = { unhelpful: 'u', basic: 'b', advanced: 'a' }[b.kind];
      expect(code).toMatch(new RegExp(`^${b.skill}\\.${letter}\\d+$`));
    }
  });

  it('only marks unhelpful behaviours as absence and basic ones as conditional', () => {
    for (const b of FHS_BEHAVIOURS_BY_CODE.values()) {
      if (b.absence) expect(b.kind).toBe('unhelpful');
      if (b.conditional) expect(b.kind).toBe('basic');
    }
  });

  it('gives every skill at least one basic and one advanced behaviour, so 4 is reachable', () => {
    for (const s of FHS_RUBRIC) {
      expect(s.basic.length).toBeGreaterThan(0);
      expect(s.advanced.length).toBeGreaterThan(0);
    }
  });
});

describe('deriveLevel', () => {
  const verbal = skill('verbal'); // basic b1, b2; advanced a1, a2

  it('is 1 when any unhelpful behaviour is present, whatever else was seen', () => {
    expect(
      deriveLevel(
        verbal,
        set('verbal.u1', 'verbal.b1', 'verbal.b2', 'verbal.a1'),
        set(),
      ),
    ).toBe(1);
  });

  it('is 2 with none or only some basic behaviours', () => {
    expect(deriveLevel(verbal, set(), set())).toBe(2);
    expect(deriveLevel(verbal, set('verbal.b1'), set())).toBe(2);
  });

  it('does not let an advanced behaviour lift a skill missing a basic one', () => {
    expect(deriveLevel(verbal, set('verbal.b1', 'verbal.a1'), set())).toBe(2);
  });

  it('is 3 with all basic behaviours and 4 with any advanced one on top', () => {
    expect(deriveLevel(verbal, set('verbal.b1', 'verbal.b2'), set())).toBe(3);
    expect(
      deriveLevel(verbal, set('verbal.b1', 'verbal.b2', 'verbal.a2'), set()),
    ).toBe(4);
  });

  it('drops a conditional basic from the requirement when it was not applicable', () => {
    const feedback = skill('feedback'); // feedback.b2 is conditional
    expect(deriveLevel(feedback, set('feedback.b1'), set())).toBe(2);
    expect(deriveLevel(feedback, set('feedback.b1'), set('feedback.b2'))).toBe(
      3,
    );
  });
});

describe('compositeOf', () => {
  it('averages only assessed skills and is null when none were', () => {
    const v = (key: string, level: 1 | 2 | 3 | 4 | null) => ({
      skill: key,
      opportunity: level !== null,
      observed: [],
      notApplicable: [],
      level,
    });
    expect(
      compositeOf([
        v('verbal', 3),
        v('confidentiality', null),
        v('feelings', 2),
      ]),
    ).toBe(2.5);
    expect(compositeOf([v('verbal', null)])).toBeNull();
  });
});

describe('validateJudgement', () => {
  const lines: NumberedLine[] = [
    {
      id: 'C1',
      speaker: 'client',
      text: 'Some nights I wish I would not wake up.',
      scored: true,
    },
    {
      id: 'H1',
      speaker: 'helper',
      text: 'How have you been feeling this week?',
      scored: true,
    },
    {
      id: 'H2',
      speaker: 'helper',
      text: 'It sounds like work has been really stressful.',
      scored: true,
    },
    {
      id: 'H3',
      speaker: 'helper',
      text: 'Earlier chat that was only context.',
      scored: false,
    },
  ];
  const judge = (skills: unknown[]) => validateJudgement(skills, lines);
  const verdictOf = (res: ReturnType<typeof judge>, key: string) =>
    res.verdicts.find((v) => v.skill === key)!;

  it('keeps ticks backed by a real quote from the right line and derives the level', () => {
    const res = judge([
      {
        skill: 'verbal',
        opportunity: true,
        observed: [
          { code: 'verbal.b1', line: 'H1', quote: 'How have you been feeling' },
          {
            code: 'verbal.b2',
            line: 'H2',
            quote: 'it sounds like work has been really stressful',
          },
        ],
      },
    ]);
    expect(verdictOf(res, 'verbal').observed).toEqual([
      'verbal.b1',
      'verbal.b2',
    ]);
    expect(verdictOf(res, 'verbal').level).toBe(3);
    expect(res.stats.droppedTicks).toBe(0);
  });

  it('drops a fabricated quote, a wrong speaker, a context line and a foreign code', () => {
    const res = judge([
      {
        skill: 'verbal',
        opportunity: true,
        observed: [
          {
            code: 'verbal.b1',
            line: 'H1',
            quote: 'tell me about your childhood',
          },
          { code: 'verbal.b2', line: 'C1', quote: 'wish I would not wake up' },
          { code: 'verbal.a1', line: 'H3', quote: 'only context' },
          {
            code: 'feelings.b1',
            line: 'H1',
            quote: 'How have you been feeling',
          },
        ],
      },
    ]);
    expect(verdictOf(res, 'verbal').observed).toEqual([]);
    expect(res.stats.droppedTicks).toBe(4);
  });

  it('accepts an absence behaviour only when it cites the client cue', () => {
    const cited = judge([
      {
        skill: 'harm',
        opportunity: true,
        observed: [
          { code: 'harm.u1', line: 'C1', quote: 'wish I would not wake up' },
        ],
      },
    ]);
    expect(verdictOf(cited, 'harm').level).toBe(1);

    const wrongLine = judge([
      {
        skill: 'harm',
        opportunity: true,
        observed: [
          { code: 'harm.u1', line: 'H1', quote: 'How have you been feeling' },
        ],
      },
    ]);
    expect(verdictOf(wrongLine, 'harm').level).toBe(2);
  });

  it('leaves skills with no opportunity unscored, and counts omitted skills as missing', () => {
    const res = judge([
      {
        skill: 'confidentiality',
        opportunity: false,
        observed: [
          { code: 'confidentiality.b1', line: 'H1', quote: 'feeling' },
        ],
      },
    ]);
    expect(verdictOf(res, 'confidentiality').level).toBeNull();
    expect(verdictOf(res, 'confidentiality').observed).toEqual([]);
    expect(res.stats.missingSkills).toBe(FHS_SKILL_KEYS.length - 1);
  });

  it('only waives conditional basics of the same skill', () => {
    const res = judge([
      {
        skill: 'feedback',
        opportunity: true,
        observed: [
          {
            code: 'feedback.b1',
            line: 'H1',
            quote: 'How have you been feeling',
          },
        ],
        notApplicable: ['feedback.b2', 'feedback.b1', 'verbal.b2', 'coping.b2'],
      },
    ]);
    expect(verdictOf(res, 'feedback').notApplicable).toEqual(['feedback.b2']);
    expect(verdictOf(res, 'feedback').level).toBe(3);
  });

  it('survives garbage without throwing', () => {
    expect(() => validateJudgement('nope', lines)).not.toThrow();
    expect(
      validateJudgement(null, lines).verdicts.every((v) => v.level === null),
    ).toBe(true);
  });
});

describe('normaliseForMatch', () => {
  it('ignores case and punctuation but keeps Indic vowel signs', () => {
    expect(normaliseForMatch('How ARE you, really?!')).toBe(
      'how are you really',
    );
    // "कैसे" and "कसे" differ only by a vowel sign (a Mark): they must not match.
    expect(normaliseForMatch('आप कैसे हैं?')).toContain('कैसे');
    expect(normaliseForMatch('आप कैसे हैं?').includes('कसे')).toBe(false);
  });
});

describe('parseJudgeReply', () => {
  it('reads a bare object, a fenced block, or an object inside prose', () => {
    expect(parseJudgeReply('{"skills":[]}')).toEqual({ skills: [] });
    expect(parseJudgeReply('```json\n{"skills":[1]}\n```')).toEqual({
      skills: [1],
    });
    expect(parseJudgeReply('Here you go: {"skills":[]} thanks')).toEqual({
      skills: [],
    });
    expect(parseJudgeReply('not json')).toBeNull();
    expect(parseJudgeReply('[1,2]')).toBeNull();
  });
});
