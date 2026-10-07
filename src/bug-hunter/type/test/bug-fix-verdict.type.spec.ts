import {
  latestVerdictFor,
  namedFailures,
  toBugFixVerdict,
} from '../bug-fix-verdict.type';

const ctx = {
  by: { engine: 'gemini', model: 'gemini-2.5-pro' },
  prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/812',
  prHeadSha: 'abc1234',
  runId: 'run-v',
  now: new Date('2026-10-07T10:00:00Z'),
};
const ok = (name: string, evidence = 'cmd → ok') => ({
  name,
  ok: true,
  evidence,
});

describe('toBugFixVerdict', () => {
  it('computes a pass only when every required check is ok and nothing failed', () => {
    const v = toBugFixVerdict(
      {
        verdict: 'fail', // the word is ignored; the checks decide
        confidence: 0.85,
        checks: [
          ok('repro_at_base_fails'),
          ok('repro_at_head_passes'),
          ok('suite'),
          ok('diff_vs_brief'),
          { name: 'data_file_counts', skipped: 'no data files in the diff' },
          ok('blast_radius'),
          { name: 'what_user_sees', skipped: 'no browser in CI' },
        ],
        summary: 'Fixes the missing keys, nothing else.',
      },
      ctx,
    );
    expect(v?.verdict).toBe('pass');
    expect(v?.checks.find((c) => c.name === 'data_file_counts')).toMatchObject({
      ok: null,
      skipped: 'no data files in the diff',
    });
    expect(v?.by).toEqual({ engine: 'gemini', model: 'gemini-2.5-pro' });
    expect(v?.at).toBe('2026-10-07T10:00:00.000Z');
  });

  it('fails when a required check is missing, skipped or false, whatever the verifier said', () => {
    const missing = toBugFixVerdict(
      {
        verdict: 'pass',
        checks: [
          ok('repro_at_base_fails'),
          ok('repro_at_head_passes'),
          ok('suite'),
        ],
      },
      ctx,
    );
    expect(missing?.verdict).toBe('fail');
    expect(namedFailures(missing!)).toContain('diff_vs_brief: not run');

    const skipped = toBugFixVerdict(
      {
        verdict: 'pass',
        checks: [
          ok('repro_at_base_fails'),
          ok('repro_at_head_passes'),
          { name: 'suite', skipped: 'took too long' },
          ok('diff_vs_brief'),
        ],
      },
      ctx,
    );
    expect(skipped?.verdict).toBe('fail');
    expect(namedFailures(skipped!)).toContain('suite: skipped (took too long)');

    const failed = toBugFixVerdict(
      {
        verdict: 'pass',
        checks: [
          ok('repro_at_base_fails'),
          ok('repro_at_head_passes'),
          ok('suite'),
          ok('diff_vs_brief'),
          {
            name: 'data_file_counts',
            ok: false,
            evidence: 'blank values 0 → 385 in mr.json',
          },
        ],
      },
      ctx,
    );
    expect(failed?.verdict).toBe('fail');
    expect(namedFailures(failed!)).toEqual([
      'data_file_counts: blank values 0 → 385 in mr.json',
    ]);
  });

  it('fails on scope exceeded even with every check green', () => {
    const v = toBugFixVerdict(
      {
        scopeExceeded: true,
        checks: [
          ok('repro_at_base_fails'),
          ok('repro_at_head_passes'),
          ok('suite'),
          ok('diff_vs_brief'),
        ],
      },
      ctx,
    );
    expect(v?.verdict).toBe('fail');
    expect(namedFailures(v!)).toContain(
      'scope: the diff does more than the brief asked',
    );
  });

  it('drops unknown check names and duplicate entries, and rejects a report with no checks', () => {
    const v = toBugFixVerdict(
      { checks: [ok('suite'), ok('suite', 'second'), ok('vibes')] },
      ctx,
    );
    expect(v?.checks.map((c) => c.name)).toEqual(['suite']);
    expect(v?.checks[0].evidence).toBe('cmd → ok');
    expect(toBugFixVerdict({ verdict: 'pass' }, ctx)).toBeNull();
    expect(toBugFixVerdict(null, ctx)).toBeNull();
  });
});

describe('latestVerdictFor', () => {
  const pass = toBugFixVerdict(
    {
      checks: [
        ok('repro_at_base_fails'),
        ok('repro_at_head_passes'),
        ok('suite'),
        ok('diff_vs_brief'),
      ],
    },
    { ...ctx, prHeadSha: 'head-2', now: new Date('2026-10-07T12:00:00Z') },
  )!;
  const fail = toBugFixVerdict(
    { checks: [] },
    { ...ctx, prHeadSha: 'head-1', now: new Date('2026-10-07T11:00:00Z') },
  )!;

  it('returns the newest verdict for the PR, and only one for the given head', () => {
    expect(latestVerdictFor([fail, pass], ctx.prUrl)?.verdict).toBe('pass');
    expect(latestVerdictFor([fail, pass], ctx.prUrl, 'head-1')?.verdict).toBe(
      'fail',
    );
    expect(latestVerdictFor([fail, pass], ctx.prUrl, 'head-3')).toBeNull();
  });

  it('matches nothing for another PR or an empty list', () => {
    expect(
      latestVerdictFor([pass], 'https://github.com/x/y/pull/1'),
    ).toBeNull();
    expect(latestVerdictFor([], ctx.prUrl)).toBeNull();
    expect(latestVerdictFor(undefined, ctx.prUrl)).toBeNull();
  });
});
