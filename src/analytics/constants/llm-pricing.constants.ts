/**
 * Per-model pricing used to convert token counts into an ESTIMATED USD cost for
 * the super-admin token-consumption chart. Tokens are the source of truth; cost
 * is derived at read time and never stored, so these rates are easy to update.
 *
 * Rates are USD per 1,000,000 tokens, split into input (prompt) and output
 * (completion). Prompt-cache tokens (cachedTokens = reads, cacheCreationTokens
 * = writes) are priced off the same per-model input rate via the multipliers
 * below — see computeCostUsd. This assumes the standard 5-minute cache TTL;
 * Anthropic's 1-hour TTL writes bill at 2x input instead of 1.25x, but
 * modelUsage as reported by the Claude Code CLI doesn't break writes out by
 * TTL, so this is still an approximation, not a billed amount.
 *
 * ANTHROPIC rates are current (verified via the claude-api reference, 2026-06).
 * OPENAI / GEMINI rates verified against the providers' public pricing pages
 * (2026-06). Unknown models fall through gracefully: cost 0 + priced=false,
 * with token totals still shown.
 */
export interface ModelPricing {
  inputPer1MUsd: number;
  outputPer1MUsd: number;
}

// Anthropic prompt-cache multipliers, applied to a model's base input rate.
// Cache reads are far cheaper than a fresh input token; cache writes carry a
// premium (5-minute TTL rate — see the file-level comment above).
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // --- Anthropic (current) ---
  'claude-fable-5': { inputPer1MUsd: 10, outputPer1MUsd: 50 },
  // Note the resolver matches by prefix (see resolvePricing below), so this
  // entry also covers the "claude-opus-5[1m]" variant id the Claude Code CLI
  // reports in its own modelUsage — Bug Hunter's cost-reporting step also
  // normalizes to the plain id via canonicalModel, but this entry is what
  // prices it if that ever falls back to the raw key.
  'claude-opus-5': { inputPer1MUsd: 5, outputPer1MUsd: 25 },
  'claude-opus-4-8': { inputPer1MUsd: 5, outputPer1MUsd: 25 },
  'claude-opus-4-7': { inputPer1MUsd: 5, outputPer1MUsd: 25 },
  'claude-opus-4-6': { inputPer1MUsd: 5, outputPer1MUsd: 25 },
  'claude-opus-4-5': { inputPer1MUsd: 5, outputPer1MUsd: 25 },
  'claude-opus-4-1': { inputPer1MUsd: 15, outputPer1MUsd: 75 },
  // Sticker rate ($3/$15) rather than the 2026-08-31 introductory discount —
  // this table prices at list, not at time-bound promotions.
  'claude-sonnet-5': { inputPer1MUsd: 3, outputPer1MUsd: 15 },
  'claude-sonnet-4-6': { inputPer1MUsd: 3, outputPer1MUsd: 15 },
  'claude-sonnet-4-5': { inputPer1MUsd: 3, outputPer1MUsd: 15 },
  'claude-haiku-4-5': { inputPer1MUsd: 1, outputPer1MUsd: 5 },

  // --- OpenAI (verified 2026-06) ---
  'gpt-5': { inputPer1MUsd: 1.25, outputPer1MUsd: 10 },
  'gpt-5-mini': { inputPer1MUsd: 0.25, outputPer1MUsd: 2 },
  'gpt-4o': { inputPer1MUsd: 2.5, outputPer1MUsd: 10 },
  'gpt-4o-mini': { inputPer1MUsd: 0.15, outputPer1MUsd: 0.6 },
  'gpt-4': { inputPer1MUsd: 30, outputPer1MUsd: 60 },
  'gpt-3.5-turbo': { inputPer1MUsd: 0.5, outputPer1MUsd: 1.5 },
  o1: { inputPer1MUsd: 15, outputPer1MUsd: 60 },
  'o1-mini': { inputPer1MUsd: 1.1, outputPer1MUsd: 4.4 },
  'text-embedding-3-small': { inputPer1MUsd: 0.02, outputPer1MUsd: 0 },

  // --- Gemini (verified 2026-06) ---
  // 2.5-pro is tiered: 1.25/10 for prompts <=200k tokens, 2.50/15 above; we
  // price at the <=200k tier (consistent with the v1 approximation note above).
  'gemini-2.5-pro': { inputPer1MUsd: 1.25, outputPer1MUsd: 10 },
  // Required, not optional: every Indic language except Malayalam moved onto
  // 2.5-flash in 1881000000000-MoveLanguagesOffExperimentalGemini. Their
  // previous model, gemini-2.0-flash-exp, was priced by the longest-prefix
  // match on 'gemini-2.0-flash' below — so those sessions HAD a cost. Without
  // this entry the migration would have silently dropped them to $0, reading as
  // "free" rather than "unknown".
  'gemini-2.5-flash': { inputPer1MUsd: 0.3, outputPer1MUsd: 2.5 },
  // 2.0-flash retired 2026-06-01; kept to price historical token records —
  // including the -exp variant, which resolves here by prefix.
  'gemini-2.0-flash': { inputPer1MUsd: 0.1, outputPer1MUsd: 0.4 },
};

// Longest prefix first so a dated/suffixed id (e.g. gpt-4o-2024-08-06,
// claude-sonnet-4-6-20250514) resolves to the most specific known base id.
const PRICING_KEYS_BY_LENGTH = Object.keys(MODEL_PRICING).sort(
  (a, b) => b.length - a.length,
);

function resolvePricing(model: string): ModelPricing | undefined {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  return PRICING_KEYS_BY_LENGTH.map((key) =>
    model.startsWith(key) ? MODEL_PRICING[key] : undefined,
  ).find((p): p is ModelPricing => p !== undefined);
}

/**
 * Estimated USD cost for a (model, promptTokens, completionTokens) tuple,
 * optionally including prompt-cache read/write tokens (see the multipliers
 * above). `priced` is false when the model has no pricing entry — the caller
 * should still surface the token totals (cost 0) and can flag it in the UI.
 */
export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheTokens?: { cacheReadTokens?: number; cacheCreationTokens?: number },
): { costUsd: number; priced: boolean } {
  const pricing = resolvePricing(model);
  if (!pricing) return { costUsd: 0, priced: false };
  const costUsd =
    (promptTokens / 1_000_000) * pricing.inputPer1MUsd +
    (completionTokens / 1_000_000) * pricing.outputPer1MUsd +
    ((cacheTokens?.cacheReadTokens ?? 0) / 1_000_000) *
      pricing.inputPer1MUsd *
      CACHE_READ_MULTIPLIER +
    ((cacheTokens?.cacheCreationTokens ?? 0) / 1_000_000) *
      pricing.inputPer1MUsd *
      CACHE_WRITE_MULTIPLIER;
  return { costUsd, priced: true };
}

// ---------------------------------------------------------------------------
// STT (speech-to-text) — billed per audio MINUTE. Keyed by provider; the
// specific model rarely changes the per-minute rate materially.
// TTS (text-to-speech) — billed per 1,000,000 CHARACTERS, keyed by provider.
// All STT/TTS rates are ESTIMATES — confirm against each provider's current
// pricing page. Unknown providers fall through gracefully (priced=false).
// ---------------------------------------------------------------------------
export const STT_PRICING_PER_MINUTE_USD: Record<string, number> = {
  deepgram: 0.0077,
  openai: 0.006, // whisper-1
  google: 0.016, // chirp_2 (v2)
  sarvam: 0.006,
  elevenlabs: 0.0067, // scribe
};

export const TTS_PRICING_PER_1M_CHARS_USD: Record<string, number> = {
  deepgram: 15, // aura
  openai: 15,
  google: 16, // WaveNet/Chirp3-HD tier
  elevenlabs: 150, // flagship tiers vary widely
  sarvam: 20,
  hume: 100,
};

export type AiServiceName = 'llm' | 'stt' | 'tts';

export interface ServiceUsageQuantities {
  promptTokens?: number;
  completionTokens?: number;
  audioMs?: number;
  characters?: number;
}

/**
 * Estimated USD cost for any AI-service usage row, dispatched by `service`:
 *  - llm → tokens × per-1M-token model pricing
 *  - stt → audio minutes × per-minute provider pricing
 *  - tts → characters × per-1M-char provider pricing
 * `priced` is false when there's no matching pricing entry (cost 0; quantities
 * still surfaced).
 */
export function computeServiceCostUsd(
  service: AiServiceName,
  provider: string,
  model: string,
  q: ServiceUsageQuantities,
): { costUsd: number; priced: boolean } {
  if (service === 'stt') {
    const rate = STT_PRICING_PER_MINUTE_USD[provider];
    if (rate == null) return { costUsd: 0, priced: false };
    return { costUsd: ((q.audioMs ?? 0) / 1000 / 60) * rate, priced: true };
  }
  if (service === 'tts') {
    const rate = TTS_PRICING_PER_1M_CHARS_USD[provider];
    if (rate == null) return { costUsd: 0, priced: false };
    return { costUsd: ((q.characters ?? 0) / 1_000_000) * rate, priced: true };
  }
  return computeCostUsd(model, q.promptTokens ?? 0, q.completionTokens ?? 0);
}
