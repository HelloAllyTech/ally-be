import {
  FHS_RUBRIC,
  FHS_SKILL_KEYS,
} from '../constants/helping-skills-rubric.constants';
import {
  RaterSkillTicks,
  SampleCandidate,
  allocateProportional,
  assignTerciles,
  lastCompleteQuarterKey,
  parseQuarter,
  quarterKeyOf,
  sampleHash,
  selectQuarterSample,
  validateHumanTicks,
} from '../util/human-rating.util';
import { deriveLevel } from '../util/skill-scoring.util';

// ─────────────────────────────────────────────────────────────────────────────
// Quarters
// ─────────────────────────────────────────────────────────────────────────────

describe('calendar quarters', () => {
  it('parses a quarter key into [start, next start)', () => {
    expect(parseQuarter('2026Q1')).toEqual({
      key: '2026Q1',
      startDate: '2026-01-01',
      endDate: '2026-04-01',
    });
    expect(parseQuarter('2026Q3')).toEqual({
      key: '2026Q3',
      startDate: '2026-07-01',
      endDate: '2026-10-01',
    });
    // Q4 rolls into the next year.
    expect(parseQuarter('2026Q4')).toEqual({
      key: '2026Q4',
      startDate: '2026-10-01',
      endDate: '2027-01-01',
    });
  });

  it('rejects anything that is not YYYYQn', () => {
    for (const bad of ['2026Q0', '2026Q5', '2026-Q3', '26Q3', '2026q3', '']) {
      expect(parseQuarter(bad)).toBeNull();
    }
  });

  it('reads the quarter of a moment in UTC', () => {
    expect(quarterKeyOf(new Date('2026-03-31T23:59:59Z'))).toBe('2026Q1');
    expect(quarterKeyOf(new Date('2026-04-01T00:00:00Z'))).toBe('2026Q2');
    expect(quarterKeyOf(new Date('2026-12-31T12:00:00Z'))).toBe('2026Q4');
  });

  it('defaults to the last quarter that has ended', () => {
    expect(lastCompleteQuarterKey(new Date('2026-10-05T00:00:00Z'))).toBe(
      '2026Q3',
    );
    expect(lastCompleteQuarterKey(new Date('2027-02-01T00:00:00Z'))).toBe(
      '2026Q4',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Allocation
// ─────────────────────────────────────────────────────────────────────────────

describe('allocateProportional', () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('splits exactly in proportion when the shares are whole', () => {
    expect(allocateProportional([60, 30, 10], 30)).toEqual([18, 9, 3]);
  });

  it('always draws exactly the target when there are enough cuts', () => {
    const sizes = [37, 11, 5, 52, 1, 9];
    const alloc = allocateProportional(sizes, 30);
    expect(sum(alloc)).toBe(30);
    alloc.forEach((a, i) => expect(a).toBeLessThanOrEqual(sizes[i]));
  });

  it('gives every non-empty stratum at least one', () => {
    const alloc = allocateProportional([97, 2, 1, 0], 30);
    expect(alloc).toEqual([28, 1, 1, 0]);
  });

  it('keeps each stratum within one draw of its proportional share', () => {
    const sizes = [40, 25, 20, 10, 5];
    const total = sum(sizes);
    const alloc = allocateProportional(sizes, 30);
    alloc.forEach((a, i) =>
      expect(Math.abs(a - (30 * sizes[i]) / total)).toBeLessThan(1),
    );
  });

  it('takes everything from a small quarter', () => {
    expect(allocateProportional([4, 0, 7], 30)).toEqual([4, 0, 7]);
    expect(allocateProportional([], 30)).toEqual([]);
  });

  it('never allocates past a stratum’s size, redistributing the rest', () => {
    // Stratum 1's share would be 0.33×30 = 10 — it only holds 2.
    const alloc = allocateProportional([20, 2, 8], 15);
    expect(alloc[1]).toBeLessThanOrEqual(2);
    expect(sum(alloc)).toBe(15);
  });

  it('with more strata than draws, the largest strata get one each', () => {
    expect(allocateProportional([5, 9, 1, 7], 2)).toEqual([0, 1, 0, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sampling
// ─────────────────────────────────────────────────────────────────────────────

const uuid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const candidates = (
  n: number,
  language: (i: number) => string = () => 'en',
): SampleCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    cutId: uuid(i + 1),
    compositeScore: 1 + ((i * 7) % 31) / 10,
    language: language(i),
  }));

describe('assignTerciles', () => {
  it('splits by rank into three equal-count bands, lowest composite first', () => {
    const cs = candidates(9);
    const t = assignTerciles(cs, '2026Q3');
    const sorted = [...cs].sort((a, b) => a.compositeScore - b.compositeScore);
    expect(sorted.map((c) => t.get(c.cutId))).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3,
    ]);
  });

  it('breaks composite ties by the seeded hash, not input order', () => {
    const tied = Array.from({ length: 6 }, (_, i) => ({
      cutId: uuid(i + 1),
      compositeScore: 2.5,
      language: 'en',
    }));
    const a = assignTerciles(tied, '2026Q3');
    const b = assignTerciles([...tied].reverse(), '2026Q3');
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});

describe('selectQuarterSample', () => {
  const lang = (i: number) => (i % 4 === 0 ? 'hi' : 'en');

  it('is deterministic: same candidates, any order → same sample', () => {
    const cs = candidates(120, lang);
    const shuffled = [...cs].sort((a, b) =>
      sampleHash('shuffle', a.cutId) < sampleHash('shuffle', b.cutId) ? -1 : 1,
    );
    const a = selectQuarterSample(cs, '2026Q3');
    const b = selectQuarterSample(shuffled, '2026Q3');
    expect(b.items.map((i) => i.candidate.cutId)).toEqual(
      a.items.map((i) => i.candidate.cutId),
    );
    expect(b.strata).toEqual(a.strata);
  });

  it('draws 30 from a large quarter, across every tercile × language stratum', () => {
    const s = selectQuarterSample(candidates(120, lang), '2026Q3');
    expect(s.population).toBe(120);
    expect(s.items).toHaveLength(30);
    expect(s.strata.map((x) => `${x.tercile}|${x.language}`)).toEqual(
      expect.arrayContaining(['1|en', '1|hi', '2|en', '2|hi', '3|en', '3|hi']),
    );
    s.strata.forEach((x) => expect(x.allocated).toBeGreaterThanOrEqual(1));
    expect(s.strata.reduce((a, x) => a + x.allocated, 0)).toBe(30);
    // Each item's tercile is its stratum's.
    for (const item of s.items) {
      const stratum = s.strata.find(
        (x) =>
          x.tercile === item.tercile && x.language === item.candidate.language,
      );
      expect(stratum).toBeDefined();
    }
  });

  it('allocates proportionally to stratum size (≈ 3:1 en:hi here)', () => {
    const s = selectQuarterSample(candidates(120, lang), '2026Q3');
    const en = s.items.filter((i) => i.candidate.language === 'en').length;
    const hi = s.items.filter((i) => i.candidate.language === 'hi').length;
    expect(en + hi).toBe(30);
    expect(en).toBeGreaterThanOrEqual(21);
    expect(en).toBeLessThanOrEqual(24);
  });

  it('takes the first cuts of each stratum in seeded-hash order', () => {
    const cs = candidates(120, () => 'en');
    const s = selectQuarterSample(cs, '2026Q3');
    for (const stratum of s.strata) {
      const members = s.items
        .filter((i) => i.tercile === stratum.tercile)
        .map((i) => sampleHash('2026Q3', i.candidate.cutId));
      expect(members).toEqual([...members].sort());
    }
  });

  it('a different quarter seeds a different order', () => {
    const cs = candidates(120, () => 'en');
    const q3 = selectQuarterSample(cs, '2026Q3').items.map(
      (i) => i.candidate.cutId,
    );
    const q4 = selectQuarterSample(cs, '2026Q4').items.map(
      (i) => i.candidate.cutId,
    );
    expect(q4).not.toEqual(q3);
  });

  it('takes the whole of a small quarter', () => {
    const s = selectQuarterSample(candidates(7, lang), '2026Q1');
    expect(s.items).toHaveLength(7);
    expect(s.population).toBe(7);
  });

  it('handles an empty quarter', () => {
    const s = selectQuarterSample([], '2026Q1');
    expect(s).toEqual({
      quarter: '2026Q1',
      population: 0,
      target: 30,
      strata: [],
      items: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A rater's ticks
// ─────────────────────────────────────────────────────────────────────────────

/** Every skill with no opportunity, then the overrides. */
const ticks = (
  overrides: Record<string, Omit<RaterSkillTicks, 'skill'>> = {},
): RaterSkillTicks[] =>
  FHS_SKILL_KEYS.map(
    (skill): RaterSkillTicks => ({
      skill,
      ...(overrides[skill] ?? { opportunity: false }),
    }),
  );

describe('validateHumanTicks — level derivation', () => {
  const levelOf = (
    r: ReturnType<typeof validateHumanTicks>,
    skill: string,
  ): number | null => {
    if (!r.ok) throw new Error(r.errors.join('; '));
    return r.rating.verdicts.find((v) => v.skill === skill)!.level;
  };

  it('derives every level with the judge’s rule, never taking one from the rater', () => {
    // any unhelpful → 1, even with every basic and an advanced
    expect(
      levelOf(
        validateHumanTicks(
          ticks({
            verbal: {
              opportunity: true,
              observed: ['verbal.u1', 'verbal.b1', 'verbal.b2', 'verbal.a1'],
            },
          }),
        ),
        'verbal',
      ),
    ).toBe(1);
    // some basics → 2
    expect(
      levelOf(
        validateHumanTicks(
          ticks({ verbal: { opportunity: true, observed: ['verbal.b1'] } }),
        ),
        'verbal',
      ),
    ).toBe(2);
    // a basic missing, an advanced present → still 2
    expect(
      levelOf(
        validateHumanTicks(
          ticks({
            verbal: { opportunity: true, observed: ['verbal.b1', 'verbal.a1'] },
          }),
        ),
        'verbal',
      ),
    ).toBe(2);
    // all basics → 3; plus an advanced → 4
    expect(
      levelOf(
        validateHumanTicks(
          ticks({
            verbal: { opportunity: true, observed: ['verbal.b1', 'verbal.b2'] },
          }),
        ),
        'verbal',
      ),
    ).toBe(3);
    expect(
      levelOf(
        validateHumanTicks(
          ticks({
            verbal: {
              opportunity: true,
              observed: ['verbal.b2', 'verbal.a2', 'verbal.b1'],
            },
          }),
        ),
        'verbal',
      ),
    ).toBe(4);
    // no opportunity → no level
    expect(levelOf(validateHumanTicks(ticks()), 'verbal')).toBeNull();
  });

  it('a waived conditional basic drops out of "every basic", as for the judge', () => {
    const r = validateHumanTicks(
      ticks({
        feedback: {
          opportunity: true,
          observed: ['feedback.b1'],
          notApplicable: ['feedback.b2'],
        },
      }),
    );
    expect(levelOf(r, 'feedback')).toBe(3);
    const skill = FHS_RUBRIC.find((s) => s.key === 'feedback')!;
    expect(levelOf(r, 'feedback')).toBe(
      deriveLevel(skill, new Set(['feedback.b1']), new Set(['feedback.b2'])),
    );
  });

  it('stores the judge verdict shape: every skill, rubric order, codes sorted and de-duplicated', () => {
    const r = validateHumanTicks(
      ticks({
        verbal: {
          opportunity: true,
          observed: ['verbal.b2', 'verbal.b1', 'verbal.b2'],
        },
      }),
    );
    if (!r.ok) throw new Error(r.errors.join('; '));
    expect(r.rating.verdicts.map((v) => v.skill)).toEqual([...FHS_SKILL_KEYS]);
    expect(r.rating.verdicts[0]).toEqual({
      skill: 'verbal',
      opportunity: true,
      level: 3,
      observed: ['verbal.b1', 'verbal.b2'],
      notApplicable: [],
    });
    expect(r.rating.anyUnhelpful).toBe(false);
  });

  it('derives anyUnhelpful from the ticks and accepts a matching cross-check', () => {
    const t = ticks({
      harm: { opportunity: true, observed: ['harm.u1'] },
    });
    const r = validateHumanTicks(t, true);
    expect(r.ok && r.rating.anyUnhelpful).toBe(true);
  });
});

describe('validateHumanTicks — rejects what does not fit the rubric', () => {
  const errorsOf = (r: ReturnType<typeof validateHumanTicks>): string[] =>
    r.ok ? [] : r.errors;

  it('rejects an unknown behaviour code', () => {
    const errors = errorsOf(
      validateHumanTicks(
        ticks({ verbal: { opportunity: true, observed: ['verbal.b9'] } }),
      ),
    );
    expect(errors).toEqual([
      '"verbal.b9" is not a behaviour of skill "verbal"',
    ]);
  });

  it('rejects a real code filed under the wrong skill', () => {
    expect(
      errorsOf(
        validateHumanTicks(
          ticks({ verbal: { opportunity: true, observed: ['harm.b1'] } }),
        ),
      ),
    ).toEqual(['"harm.b1" is not a behaviour of skill "verbal"']);
  });

  it('rejects an unknown skill, a duplicate skill and a missing skill', () => {
    const base = ticks();
    const errors = errorsOf(
      validateHumanTicks([
        ...base.filter((t) => t.skill !== 'hope'),
        { skill: 'non-verbal', opportunity: false },
        { skill: 'verbal', opportunity: false },
      ]),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'Unknown skill "non-verbal"',
        'Skill "verbal" appears more than once',
        expect.stringContaining('Skill "hope" is missing'),
      ]),
    );
  });

  it('rejects ticks on a skill marked as having no opportunity', () => {
    expect(
      errorsOf(
        validateHumanTicks(
          ticks({ verbal: { opportunity: false, observed: ['verbal.b1'] } }),
        ),
      ),
    ).toEqual(['Skill "verbal" has no opportunity but has behaviours ticked']);
  });

  it('only a conditional basic of the skill may be marked not applicable', () => {
    const errors = errorsOf(
      validateHumanTicks(
        ticks({
          verbal: { opportunity: true, notApplicable: ['verbal.b1'] },
          feedback: {
            opportunity: true,
            observed: ['feedback.b2'],
            notApplicable: ['feedback.b2'],
          },
        }),
      ),
    );
    expect(errors).toEqual([
      expect.stringContaining('"verbal.b1" cannot be marked not applicable'),
      '"feedback.b2" is marked both observed and not applicable',
    ]);
  });

  it('rejects an anyUnhelpful cross-check that contradicts the ticks', () => {
    expect(
      errorsOf(
        validateHumanTicks(
          ticks({ verbal: { opportunity: true, observed: ['verbal.b1'] } }),
          true,
        ),
      ),
    ).toEqual([expect.stringContaining('no unhelpful behaviour is ticked')]);
    expect(
      errorsOf(
        validateHumanTicks(
          ticks({ verbal: { opportunity: true, observed: ['verbal.u2'] } }),
          false,
        ),
      ),
    ).toEqual([expect.stringContaining('an unhelpful behaviour is ticked')]);
  });
});
