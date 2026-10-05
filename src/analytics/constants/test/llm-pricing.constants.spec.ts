import { LlmTask } from '../../../learn/enum/llm-task.enum';
import {
  computeCostUsd,
  computeServiceCostUsd,
  MODEL_PRICING,
} from '../llm-pricing.constants';

describe('MODEL_PRICING — Gemini coverage', () => {
  /**
   * Every Indic language except Malayalam runs gemini-2.5-flash after
   * 1881000000000-MoveLanguagesOffExperimentalGemini. Without an entry the
   * token-consumption chart silently reported $0 for the bulk of those
   * sessions, which reads as "free" rather than "unknown".
   */
  it('prices gemini-2.5-flash, the model most languages now run', () => {
    expect(MODEL_PRICING['gemini-2.5-flash']).toMatchObject({
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

describe('pricing ids the providers actually report', () => {
  it('prices a `models/`-prefixed Gemini id like the bare id', () => {
    // The Gemini SDK reports some calls by resource name; those rows were
    // priced $0 ("free") instead of at the 2.5-flash rate.
    expect(computeCostUsd('models/gemini-2.5-flash', 1_000_000, 0)).toEqual(
      computeCostUsd('gemini-2.5-flash', 1_000_000, 0),
    );
  });

  it('prices Cartesia TTS by provider, whatever lands in `model`', () => {
    for (const model of ['sonic-3.6', 'Skyler Cartesia - Hindi']) {
      const { costUsd, priced } = computeServiceCostUsd(
        'tts',
        'cartesia',
        model,
        { characters: 1_000_000 },
      );
      expect(priced).toBe(true);
      expect(costUsd).toBeCloseTo(37, 5);
    }
  });

  it('leaves image models unpriced rather than pricing them per token', () => {
    expect(computeCostUsd('gpt-image-1', 1000, 1000).priced).toBe(false);
  });
});

describe('computeServiceCostUsd — cached prompt tokens (OpenAI, Gemini)', () => {
  /**
   * OpenAI's prompt_tokens and Gemini's prompt_token_count both INCLUDE the
   * cached tokens, so the cached share is carved out of the prompt and priced
   * at the cheaper rate — never added on top, which is Anthropic's accounting.
   */
  it('prices an OpenAI cached share at the cached rate, the rest at input', () => {
    const { costUsd, priced } = computeServiceCostUsd(
      'llm',
      'openai',
      'gpt-4o-mini',
      { promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 400_000 },
    );
    expect(priced).toBe(true);
    // 600k fresh at $0.15/1M + 400k cached at $0.075/1M
    expect(costUsd).toBeCloseTo(0.09 + 0.03, 6);
  });

  it('prices a Gemini cached share the same way', () => {
    const { costUsd } = computeServiceCostUsd(
      'llm',
      'gemini',
      'gemini-2.5-flash',
      {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
        cachedTokens: 1_000_000,
      },
    );
    // all 1M prompt cached at $0.03/1M + 1M output at $2.50/1M
    expect(costUsd).toBeCloseTo(0.03 + 2.5, 6);
  });

  it('is unchanged when nothing was cached', () => {
    expect(
      computeServiceCostUsd('llm', 'openai', 'gpt-5-mini', {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
      }).costUsd,
    ).toBeCloseTo(
      computeCostUsd('gpt-5-mini', 1_000_000, 1_000_000).costUsd,
      10,
    );
  });

  it('never carves out more than the prompt held', () => {
    // A malformed aggregate (cached > prompt) must not price below zero.
    const { costUsd } = computeServiceCostUsd('llm', 'openai', 'gpt-4o', {
      promptTokens: 100_000,
      completionTokens: 0,
      cachedTokens: 500_000,
    });
    expect(costUsd).toBeCloseTo((100_000 / 1_000_000) * 1.25, 10);
    expect(costUsd).toBeGreaterThan(0);
  });

  it('keeps the full input rate for a model with no cached rate', () => {
    // o1 has no cachedInputPer1MUsd: pre-existing behaviour, never under-priced.
    expect(
      computeServiceCostUsd('llm', 'openai', 'o1', {
        promptTokens: 1_000_000,
        completionTokens: 0,
        cachedTokens: 1_000_000,
      }).costUsd,
    ).toBeCloseTo(15, 6);
  });

  it('does not carve cache out of runner rows that are already net of it', () => {
    // Bug Hunter / Builder build rows come from CI runner reports whose
    // inputTokens EXCLUDES cache reads, whatever the provider.
    for (const task of [LlmTask.BUG_HUNTER, LlmTask.BUILDER_BUILD]) {
      expect(
        computeServiceCostUsd(
          'llm',
          'gemini',
          'gemini-2.5-pro',
          {
            promptTokens: 1_000_000,
            completionTokens: 0,
            totalTokens: 1_000_000,
            cachedTokens: 5_000_000,
          },
          task,
        ).costUsd,
      ).toBeCloseTo(1.25, 6);
    }
  });
});

describe('computeServiceCostUsd — Gemini thinking tokens', () => {
  /**
   * Gemini reports thought tokens only inside total_token_count, billed at the
   * output rate. ally-ai recorded candidates alone as completion, so the gap
   * between total and prompt + completion is the unpriced thinking.
   */
  it('prices total - prompt - completion at the output rate', () => {
    const { costUsd } = computeServiceCostUsd(
      'llm',
      'gemini',
      'gemini-2.5-pro',
      {
        promptTokens: 1_000_000,
        completionTokens: 100_000,
        totalTokens: 1_600_000,
      },
    );
    // 1M in at $1.25 + (100k candidates + 500k thoughts) out at $10/1M
    expect(costUsd).toBeCloseTo(1.25 + 6, 6);
  });

  it('adds nothing once thoughts are folded into completion', () => {
    // The ally-ai fix makes total == prompt + completion, so no double count.
    const folded = computeServiceCostUsd('llm', 'gemini', 'gemini-2.5-pro', {
      promptTokens: 1_000_000,
      completionTokens: 600_000,
      totalTokens: 1_600_000,
    });
    expect(folded.costUsd).toBeCloseTo(1.25 + 6, 6);
  });

  it('never subtracts when total is missing or short', () => {
    const base = computeCostUsd('gemini-2.5-flash', 1_000_000, 1_000_000);
    for (const totalTokens of [undefined, 0, 1_500_000]) {
      expect(
        computeServiceCostUsd('llm', 'gemini', 'gemini-2.5-flash', {
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens,
        }).costUsd,
      ).toBeCloseTo(base.costUsd, 10);
    }
  });

  it('applies to Gemini only — an OpenAI total is never read', () => {
    // OpenAI reasoning tokens are already inside completion_tokens.
    expect(
      computeServiceCostUsd('llm', 'openai', 'gpt-5', {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 9_000_000,
      }).costUsd,
    ).toBeCloseTo(1.25 + 10, 6);
  });
});

describe('computeServiceCostUsd — Anthropic and unknown models unchanged', () => {
  it('prices Anthropic on prompt + completion only, ignoring cache and total', () => {
    // Anthropic reports cache tokens IN ADDITION to input; that accounting
    // lives in computeCostUsd and this path deliberately does not touch it.
    const { costUsd, priced } = computeServiceCostUsd(
      'llm',
      'anthropic',
      'claude-sonnet-5',
      {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 9_000_000,
        cachedTokens: 1_000_000,
      },
    );
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(
      computeCostUsd('claude-sonnet-5', 1_000_000, 1_000_000).costUsd,
      10,
    );
  });

  it('leaves an unknown model unpriced on every provider', () => {
    for (const provider of ['openai', 'gemini', 'anthropic']) {
      expect(
        computeServiceCostUsd('llm', provider, 'some-future-model', {
          promptTokens: 500,
          completionTokens: 500,
          totalTokens: 2_000,
          cachedTokens: 100,
        }),
      ).toEqual({ costUsd: 0, priced: false });
    }
  });
});
