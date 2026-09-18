import { computeCostUsd, MODEL_PRICING } from '../llm-pricing.constants';

describe('MODEL_PRICING — Gemini coverage', () => {
  /**
   * Every Indic language except Malayalam runs gemini-2.5-flash after
   * 1881000000000-MoveLanguagesOffExperimentalGemini. Without an entry the
   * token-consumption chart silently reported $0 for the bulk of those
   * sessions, which reads as "free" rather than "unknown".
   */
  it('prices gemini-2.5-flash, the model most languages now run', () => {
    expect(MODEL_PRICING['gemini-2.5-flash']).toEqual({
      inputPer1MUsd: 0.3,
      outputPer1MUsd: 2.5,
    });

    const { costUsd, priced } = computeCostUsd(
      'gemini-2.5-flash',
      1_000_000,
      1_000_000,
    );
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(2.8, 5);
  });

  it('keeps the retired 2.0-flash priced so historical rows still cost out', () => {
    expect(computeCostUsd('gemini-2.0-flash', 1_000_000, 0).priced).toBe(true);
  });

  // resolvePricing does longest-prefix matching, so the -exp variant those
  // languages ran until the migration resolved to the 2.0-flash rate. It was
  // never $0 — which is exactly why 2.5-flash needed an entry: moving them
  // without one would have turned a real cost into a silent zero.
  it('prices 2.0-flash-exp by prefix, so historical rows keep their cost', () => {
    const exp = computeCostUsd('gemini-2.0-flash-exp', 1_000_000, 1_000_000);
    const ga = computeCostUsd('gemini-2.0-flash', 1_000_000, 1_000_000);
    expect(exp.priced).toBe(true);
    expect(exp.costUsd).toBeCloseTo(ga.costUsd, 10);
  });

  it('degrades gracefully for a model nobody has priced', () => {
    const { costUsd, priced } = computeCostUsd('some-future-model', 500, 500);
    expect(priced).toBe(false);
    expect(costUsd).toBe(0);
  });
});

describe('computeCostUsd — prompt-cache pricing', () => {
  /**
   * Bug Hunter's "Est. cost" tile undercounted real Anthropic spend because
   * cache read/write tokens were tracked but never priced — this is the
   * regression test for that fix (see llm-pricing.constants.ts multipliers).
   */
  it('prices cache reads at 0.1x and cache writes at 1.25x the input rate', () => {
    const base = computeCostUsd('claude-sonnet-5', 0, 0);
    expect(base.costUsd).toBe(0);

    const withCacheRead = computeCostUsd('claude-sonnet-5', 0, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(withCacheRead.priced).toBe(true);
    expect(withCacheRead.costUsd).toBeCloseTo(0.3, 5); // 0.1 * $3/1M

    const withCacheWrite = computeCostUsd('claude-sonnet-5', 0, 0, {
      cacheCreationTokens: 1_000_000,
    });
    expect(withCacheWrite.costUsd).toBeCloseTo(3.75, 5); // 1.25 * $3/1M
  });

  it('adds cache cost on top of base prompt/completion cost, not in place of it', () => {
    const { costUsd } = computeCostUsd(
      'claude-sonnet-5',
      1_000_000,
      1_000_000,
      {
        cacheReadTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
      },
    );
    // base: 3 + 15 = 18; cache read: 0.3; cache write: 3.75
    expect(costUsd).toBeCloseTo(22.05, 5);
  });
});
