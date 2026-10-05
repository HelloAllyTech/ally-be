import { LlmTask } from '../../learn/enum/llm-task.enum';

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
 *
 * The prompt-cache multipliers below are ANTHROPIC accounting, where cache
 * reads and writes are reported IN ADDITION to `input_tokens`. OpenAI and
 * Gemini report the other way round — see computeServiceCostUsd.
 */
export interface ModelPricing {
  inputPer1MUsd: number;
  outputPer1MUsd: number;
  /**
   * What a prompt token served from the provider's cache costs, for the
   * providers whose `promptTokens` INCLUDES the cached ones (OpenAI, Gemini).
   * Absent means the cached share is priced at the full input rate — the
   * pre-existing behaviour, so a model without one is never under-priced.
   * Not used for Anthropic, whose cache tokens go through the multipliers.
   */
  cachedInputPer1MUsd?: number;
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
  // cachedInputPer1MUsd: UNVERIFIED — the vendor page could not be reached
  // when these were added (2026-10); confirm against openai.com/api/pricing.
  // Half the input rate on the 4o family, a tenth on the 5 family.
  'gpt-5': {
    inputPer1MUsd: 1.25,
    outputPer1MUsd: 10,
    cachedInputPer1MUsd: 0.125,
  },
  'gpt-5-mini': {
    inputPer1MUsd: 0.25,
    outputPer1MUsd: 2,
    cachedInputPer1MUsd: 0.025,
  },
  'gpt-4o': {
    inputPer1MUsd: 2.5,
    outputPer1MUsd: 10,
    cachedInputPer1MUsd: 1.25,
  },
  'gpt-4o-mini': {
    inputPer1MUsd: 0.15,
    outputPer1MUsd: 0.6,
    cachedInputPer1MUsd: 0.075,
  },
  'gpt-4': { inputPer1MUsd: 30, outputPer1MUsd: 60 },
  'gpt-3.5-turbo': { inputPer1MUsd: 0.5, outputPer1MUsd: 1.5 },
  o1: { inputPer1MUsd: 15, outputPer1MUsd: 60 },
  'o1-mini': { inputPer1MUsd: 1.1, outputPer1MUsd: 4.4 },
  'text-embedding-3-small': { inputPer1MUsd: 0.02, outputPer1MUsd: 0 },

  // --- Gemini (verified 2026-06) ---
  // cachedInputPer1MUsd for the 2.5 models: Google's "Context caching price"
  // at ai.google.dev/gemini-api/docs/pricing, checked 2026-10-05 — a tenth of
  // the input rate (2.5-pro 0.125, 2.5-flash 0.03, text/image/video). Explicit
  // caches also bill storage per token-hour; that isn't modelled here.
  // 2.5-pro is tiered: 1.25/10 (cached 0.125) for prompts <=200k tokens,
  // 2.50/15 (cached 0.25) above; we price at the <=200k tier (consistent with
  // the v1 approximation note above).
  'gemini-2.5-pro': {
    inputPer1MUsd: 1.25,
    outputPer1MUsd: 10,
    cachedInputPer1MUsd: 0.125,
  },
  // Required, not optional: every Indic language except Malayalam moved onto
  // 2.5-flash in 1881000000000-MoveLanguagesOffExperimentalGemini. Their
  // previous model, gemini-2.0-flash-exp, was priced by the longest-prefix
  // match on 'gemini-2.0-flash' below — so those sessions HAD a cost. Without
  // this entry the migration would have silently dropped them to $0, reading as
  // "free" rather than "unknown".
  'gemini-2.5-flash': {
    inputPer1MUsd: 0.3,
    outputPer1MUsd: 2.5,
    cachedInputPer1MUsd: 0.03,
  },
  // 2.0-flash retired 2026-06-01; kept to price historical token records —
  // including the -exp variant, which resolves here by prefix. Its cached rate
  // (a quarter of input) is UNVERIFIED: the model is no longer on Google's
  // pricing page (checked 2026-10-05).
  'gemini-2.0-flash': {
    inputPer1MUsd: 0.1,
    outputPer1MUsd: 0.4,
    cachedInputPer1MUsd: 0.025,
  },

  // Deliberately absent: gpt-image-1 / gemini-2.5-flash-image. Image
  // generation bills per IMAGE (by size/quality), not per text token, so a
  // token rate here would be wrong in a way that looks right. Their rows
  // (task generate_cover_image) stay priced=false — "unknown", not "free".
};

// Longest prefix first so a dated/suffixed id (e.g. gpt-4o-2024-08-06,
// claude-sonnet-4-6-20250514) resolves to the most specific known base id.
const PRICING_KEYS_BY_LENGTH = Object.keys(MODEL_PRICING).sort(
  (a, b) => b.length - a.length,
);

function resolvePricing(model: string): ModelPricing | undefined {
  // The Gemini SDK sometimes reports the resource name (`models/gemini-2.5-
  // flash`) instead of the bare id; strip it rather than duplicate entries.
  const id = model.replace(/^models\//, '');
  if (MODEL_PRICING[id]) return MODEL_PRICING[id];
  return PRICING_KEYS_BY_LENGTH.map((key) =>
    id.startsWith(key) ? MODEL_PRICING[key] : undefined,
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
  // Keyed by provider because Cartesia rows carry either the model
  // (`sonic-3.6`) or a voice name (`Skyler Cartesia - Hindi`) as `model`.
  // Sonic bills 1 credit per character; Scale plan = $299 / 8M credits.
  cartesia: 37,
};

export type AiServiceName = 'llm' | 'stt' | 'tts';

export interface ServiceUsageQuantities {
  promptTokens?: number;
  completionTokens?: number;
  /**
   * `llm_usage.totalTokens`. Read for Gemini only, where it is the one place
   * thinking tokens show up — see computeServiceCostUsd.
   */
  totalTokens?: number;
  /**
   * `llm_usage.cachedTokens` (prompt-cache READS). For OpenAI and Gemini rows
   * a SUBSET of promptTokens — see computeServiceCostUsd.
   */
  cachedTokens?: number;
  audioMs?: number;
  characters?: number;
}

/** Providers whose `promptTokens` already INCLUDES the cache-read tokens. */
const CACHE_INCLUSIVE_PROVIDERS: ReadonlySet<string> = new Set([
  'openai',
  'gemini',
]);

/**
 * Tasks whose rows record `promptTokens` NET of cache reads whatever the
 * provider, so the cached share must not be carved out of them a second time.
 *
 * Both are written from a CI runner's own usage report rather than from the
 * vendor response: Bug Hunter's `recordActualCost` and Builder's per-phase
 * cost, fed Claude-Code-shaped `modelUsage` (inputTokens + separate
 * cacheReadInputTokens). The workflows map Gemini CLI's and opencode's
 * net-of-cache `tokens.input` onto that shape on purpose — see the "Report
 * actual token cost" step in .github/workflows/bug-hunt-sweep.yml. Their cached
 * tokens are therefore left out of this pricing exactly as before; Bug Hunter's
 * own run cost prices them through computeCostUsd.
 */
export const NET_OF_CACHE_PROMPT_TASKS: ReadonlySet<string> = new Set<string>([
  LlmTask.BUG_HUNTER,
  LlmTask.BUILDER_BUILD,
]);

/**
 * Estimated USD cost for any AI-service usage row, dispatched by `service`:
 *  - llm → tokens × per-1M-token model pricing
 *  - stt → audio minutes × per-minute provider pricing
 *  - tts → characters × per-1M-char provider pricing
 * `priced` is false when there's no matching pricing entry (cost 0; quantities
 * still surfaced).
 *
 * Two LLM rules apply to OpenAI and Gemini rows only. Anthropic (and anything
 * else) is priced on prompt + completion exactly as before.
 *
 *  1. CACHED PROMPT TOKENS ARE A SUBSET. OpenAI's `prompt_tokens` includes
 *     `prompt_tokens_details.cached_tokens`, and Gemini's `prompt_token_count`
 *     includes `cached_content_token_count`, so `cachedTokens` is part of
 *     `promptTokens`, not extra to it (the opposite of Anthropic). The cached
 *     share is priced at the model's `cachedInputPer1MUsd` and only the rest at
 *     the input rate. Clamped to promptTokens, so a malformed row can never
 *     price below zero; a model with no cached rate keeps the full input rate.
 *     Skipped for {@link NET_OF_CACHE_PROMPT_TASKS}.
 *
 *  2. GEMINI THINKING TOKENS. Gemini bills thought tokens at the output rate
 *     but reports them only in `total_token_count` (as `thoughts_token_count`),
 *     not in `candidates_token_count`. ally-ai recorded candidates alone as
 *     completion, so every 2.5 judge's thinking was unpriced. For provider
 *     'gemini', max(0, total − prompt − completion) is priced at the output
 *     rate. Once ally-ai folds thoughts into completion that difference is ~0
 *     for new rows, so nothing is counted twice, while historical rows are
 *     corrected. Writers that synthesise total as prompt + completion also
 *     give 0. Callers pass SUMS, so this is applied per aggregate rather than
 *     per row — sound because every writer records total >= prompt +
 *     completion; the floor at 0 means a bad row can only understate. Gemini's
 *     total also counts tool-use prompt tokens, which bill as input; no
 *     judge uses tools, so that is ignored rather than modelled.
 *
 * `task` is the row's `llm_usage.task`, read only to recognise
 * {@link NET_OF_CACHE_PROMPT_TASKS}. Session-scoped callers can omit it: those
 * runner tasks never carry a session.
 */
export function computeServiceCostUsd(
  service: AiServiceName,
  provider: string,
  model: string,
  q: ServiceUsageQuantities,
  task?: string,
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
  const promptTokens = q.promptTokens ?? 0;
  const completionTokens = q.completionTokens ?? 0;
  if (!CACHE_INCLUSIVE_PROVIDERS.has(provider)) {
    return computeCostUsd(model, promptTokens, completionTokens);
  }

  const pricing = resolvePricing(model);
  if (!pricing) return { costUsd: 0, priced: false };

  const cachedTokens =
    task !== undefined && NET_OF_CACHE_PROMPT_TASKS.has(task)
      ? 0
      : Math.min(Math.max(q.cachedTokens ?? 0, 0), Math.max(promptTokens, 0));
  const thinkingTokens =
    provider === 'gemini'
      ? Math.max(0, (q.totalTokens ?? 0) - promptTokens - completionTokens)
      : 0;

  const costUsd =
    ((promptTokens - cachedTokens) / 1_000_000) * pricing.inputPer1MUsd +
    (cachedTokens / 1_000_000) *
      (pricing.cachedInputPer1MUsd ?? pricing.inputPer1MUsd) +
    ((completionTokens + thinkingTokens) / 1_000_000) * pricing.outputPer1MUsd;
  return { costUsd, priced: true };
}
