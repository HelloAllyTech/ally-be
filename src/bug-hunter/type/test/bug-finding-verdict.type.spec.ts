import {
  faultLocationOf,
  isDataFault,
  independentVerificationOf,
  toBugFindingVerdict,
} from '../bug-finding-verdict.type';

const ctx = {
  by: { engine: 'claude-code', model: 'claude-sonnet-5' },
  runId: 'run-v',
  now: new Date('2026-10-07T10:00:00Z'),
};

describe('toBugFindingVerdict', () => {
  it('keeps a confirmation that comes with a reproduction', () => {
    const v = toBugFindingVerdict(
      {
        verdict: 'confirmed',
        confidence: 0.9,
        reproduction: 'wrote a failing test: 12 keys missing from mr.json',
        refutation: 'no guard upstream; keys are used by the dialog',
        wouldBeWrongIf: 'the product intends English for new keys',
      },
      ctx,
    );
    expect(v).toMatchObject({
      verdict: 'confirmed',
      confidence: 0.9,
      by: ctx.by,
      runId: 'run-v',
      at: '2026-10-07T10:00:00.000Z',
    });
  });

  it('downgrades a confirmation without a reproduction, and a refutation without a refutation, to unsure', () => {
    expect(
      toBugFindingVerdict({ verdict: 'confirmed', confidence: 0.95 }, ctx)
        ?.verdict,
    ).toBe('unsure');
    expect(
      toBugFindingVerdict({ verdict: 'refuted', reproduction: 'x' }, ctx)
        ?.verdict,
    ).toBe('unsure');
  });

  it('rejects an unknown verdict word and an out-of-range confidence', () => {
    expect(toBugFindingVerdict({ verdict: 'maybe' }, ctx)).toBeNull();
    expect(toBugFindingVerdict(null, ctx)).toBeNull();
    const v = toBugFindingVerdict(
      { verdict: 'refuted', refutation: 'guard upstream', confidence: 95 },
      ctx,
    );
    expect(v?.verdict).toBe('refuted');
    expect(v?.confidence).toBeNull();
  });
});

describe('independentVerificationOf', () => {
  it('reads only the known states', () => {
    expect(
      independentVerificationOf({ independentVerification: 'pending' }),
    ).toBe('pending');
    expect(
      independentVerificationOf({ independentVerification: 'confirmed' }),
    ).toBe('confirmed');
    expect(
      independentVerificationOf({ independentVerification: 'maybe' }),
    ).toBeNull();
    expect(independentVerificationOf(null)).toBeNull();
  });
});

describe('fault location (locate before fixing)', () => {
  const ctx2 = {
    by: { engine: 'gemini', model: 'gemini-2.5-pro' },
    runId: 'r',
  };

  it('reads the located fault off the report and keeps it on the verdict', () => {
    const v = toBugFindingVerdict(
      {
        verdict: 'confirmed',
        reproduction:
          'GET /api/v1/learn/scenarios/public?languageCode=mr returns English titles',
        faultLayer: 'data',
        faultRepo: 'ally-be',
        productionEvidence:
          'scenario 2f1c has no scenario_translations row for mr',
        repair:
          'Generate and publish Marathi translations for the four public scenarios in Studio.',
      },
      { ...ctx2, reported: true },
    );
    expect(v?.verdict).toBe('confirmed');
    expect(v?.fault).toEqual({
      layer: 'data',
      repo: 'ally-be',
      evidence: 'scenario 2f1c has no scenario_translations row for mr',
      repair:
        'Generate and publish Marathi translations for the four public scenarios in Studio.',
    });
    expect(isDataFault(v!.fault)).toBe(true);
  });

  it('holds a confirmed human report for a person when no layer was located, but not a sweep finding', () => {
    const body = { verdict: 'confirmed', reproduction: 'it happens' };
    expect(
      toBugFindingVerdict(body, { ...ctx2, reported: true })?.verdict,
    ).toBe('unsure');
    expect(
      toBugFindingVerdict(
        { ...body, faultLayer: 'unknown' },
        { ...ctx2, reported: true },
      )?.verdict,
    ).toBe('unsure');
    expect(toBugFindingVerdict(body, ctx2)?.verdict).toBe('confirmed');
    expect(toBugFindingVerdict(body, ctx2)?.fault).toBeNull();
  });

  it('finds the latest located fault on a finding, ignoring verdicts without one', () => {
    expect(
      faultLocationOf({
        findingVerdicts: [
          { verdict: 'unsure', fault: null },
          {
            verdict: 'confirmed',
            fault: {
              layer: 'code',
              repo: 'ally-web',
              evidence: null,
              repair: null,
            },
          },
          { verdict: 'confirmed', fault: { layer: 'nonsense' } },
        ],
      }),
    ).toEqual({
      layer: 'code',
      repo: 'ally-web',
      evidence: null,
      repair: null,
    });
    expect(faultLocationOf({})).toBeNull();
  });
});
