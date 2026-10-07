import {
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
