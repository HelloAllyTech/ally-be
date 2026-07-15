# ADR: Standardizing per-prompt LLM config (model + temperature) across services

- **Status:** Proposed
- **Date:** 2026-06-30
- **Scope:** ally-be, ally-ai-learn, ally-ai, ally-web
- **Decision owners:** Platform / AI

## Context

We shipped per-prompt **model + temperature** overrides: an author sets them on a
prompt/skill in Studio → Prompt Management, and the runtime that consumes that
prompt applies them. It works and is tested, but it was implemented as **three
independent ad-hoc integrations**, one per consuming runtime.

### Current state (inventory)

**Storage + delivery (ally-be)**
- `prompts.model` (varchar) + `prompts.temperature` (numeric) columns
  (`1796000000000-AddModelAndTemperatureToPrompts`).
- Delivered to **ai-learn** via `promptData.prompts[code].{model,temperature}`
  (`scenario-shared.service.ts` → `getPromptsByOptions`).
- Delivered to **ally-ai** via `getPromptOverrides()` → `PromptOverride.{model,temperature}`
  (`ai.service.ts`, `ai.request.dto.ts`).

**Consumption — three separate factories, no shared contract:**
| Runtime | Factory | Providers | Provider resolution | Wired call sites |
|---|---|---|---|---|
| ally-ai-learn | `app/llms/factory.py::create_llm_client` | OpenAI, Gemini, Ollama, vLLM | **inferred from model-name prefix** (`infer_provider_from_model`) | main agent, branching, prosody |
| ally-ai | `openai_text_generation_client.py::get_or_create_client` | OpenAI only (Gemini for drift, separate) | **inferred** (`_is_openai_model` guard) | 9 text-gen sites |
| ally-be | autofill: `openai-autofil-service` / `anthropic-autofill.service` | OpenAI, Anthropic | explicit per-service | (autofill/copilot only; not prompt-driven) |

**Model lists (UI / picker) — ~4 independent sources, already drifting:**
- `ally-web` `PROMPT_LLM_MODEL_OPTIONS` (OpenAI + Gemini, hand-curated)
- `ally-be` `PREFERRED_AUTOFILL_MODELS` + `PREFERRED_ANTHROPIC_AUTOFILL_MODELS`
- `ally-ai-learn` `DEFAULT_LLM_CONFIG`
- `ally-ai` `TextGenerationConstants.DEFAULT_MODEL`

**Precedence (where implemented):** code default → per-language `llm_config` →
prompt-level → simulation-level (temperature, main agent only).

**ally-be's own prompt-driven LLM calls (besides delivery):**
- **Coaching chat** (`scenario-session-chat.service`, prompt `openai_scenario_session_chat`)
  **now consumes** the prompt's model/temperature (OpenAI-only guard; precedence
  code → prompt → simulation), via shared `common/util/llm-model.util.ts` +
  `PromptSharedService.getPromptLlmConfig`.
- **Deliberately not wired:** tooltip translation (shared `OpenAITranslationsService`
  with intentional per-language temperature, 3 consumers), autofill, copilot (both
  already expose a per-request model pick). These would silently ignore a per-prompt
  override — a candidate for the registry's `runtimes`/capability data to make explicit.

### Problems this creates
1. **Drifting model lists** — four hand-maintained lists; we already shipped stale ones.
2. **Provider inferred from model name** — fragile: a fine-tuned/custom model id, or a
   new provider whose names don't match known prefixes, resolves wrong or not at all.
   The prompt stores only `model`, never `provider`.
3. **No capability awareness** — the UI offers a temperature slider for every model,
   but some models (o-series, some gpt-5 variants) reject a non-default temperature.
4. **No shared contract** — each runtime re-implements parsing + a factory + a provider
   set; adding a provider/model is a multi-place change in services that diverge.

## Decision

**Adopt the standardized design incrementally, triggered by need — do NOT undertake a
full unification now.**

- The feature is correct and tested for the current OpenAI+Gemini scope.
- Most of the payoff is realized only when adding the *next* provider or on ongoing
  model churn; building it all now is premature abstraction across three runtimes that
  legitimately differ.
- We capture the target design here so the next change is cheap and consistent.

**Do now:** nothing in code (this ADR).
**Do opportunistically (present value):** the shared **model registry** (kills list drift).
**Do at the next-provider trigger:** explicit `provider` on the prompt + capability flags
+ aligning the per-runtime factories to the shared contract.
**Do not:** collapse the three runtime factories into one shared client library — they
have different latency/streaming/provider needs.

## Target architecture

### 1. Shared LLM-config contract
A prompt's override is a structured object, not a bare model string:
```jsonc
{ "provider": "openai" | "gemini" | "anthropic", "model": "gpt-5", "temperature": 0.4 }
```
- **Explicit `provider`** — removes name-prefix inference everywhere.
- Documented once; every consumer parses it identically.
- `temperature` optional; precedence unchanged
  (code → language → prompt → simulation).

### 2. Model registry (single source of truth)
One ally-be endpoint, e.g. `GET /api/v1/llm/models`, returning:
```jsonc
[{ "provider": "openai", "model": "gpt-5", "label": "GPT-5",
   "supportsTemperature": true, "runtimes": ["ai-learn","ally-ai"] }, ...]
```
- All UIs consume it (replaces the ~4 hardcoded lists).
- `runtimes` tells the UI which models a given prompt's runtime can actually run, so we
  never offer a model the consumer can't instantiate (the OpenAI-only / no-Anthropic
  asymmetry becomes data, not code).
- `supportsTemperature` lets the UI disable the slider where invalid.

### 3. Per-runtime provider factories, aligned
Keep each runtime's factory (they differ), but align them to:
- a common provider enum,
- reading `provider` from the contract (no inference),
- a shared, documented fallback rule (unrunnable override → log + default, never crash —
  already the case in ai-learn `configure_llm_client` and ally-ai `_client_for`).

## Migration plan (phased, trigger-based)

- **Phase 0 (now):** this ADR.
- **Phase 1 (when list drift hurts):** model registry endpoint + point `ally-web` at it.
  Additive, low risk. No runtime changes.
- **Phase 2 (when adding the next provider, e.g. Anthropic):** add `provider` to the
  prompt config + delivery + each consumer; drop prefix inference; add the provider
  branch to whichever runtime factories need it. Add `supportsTemperature` gating.
- **Phase 3 (only if churn justifies):** extract a tiny shared "resolve config →
  (provider, model, temperature)" helper reused by the runtimes. Skip the full client
  unification.

## Consequences
- **Pro:** next provider/model is a near one-place change; no drifting lists; no silent
  provider misresolution; UI can't offer unrunnable/temperature-incompatible models.
- **Con:** the registry is net-new surface to maintain; `provider` is a schema addition
  (migration + delivery + consumers) — hence deferred to a real trigger.
- **Risk if we ignore this:** each new provider repeats the three-place ad-hoc work and
  the inference fragility compounds.

## Not doing (and why)
- Full shared LLM client library across runtimes — over-engineering; runtimes differ
  (LiveKit streaming voice vs batch analytics vs autofill).
- Provider field / capability gating *speculatively now* — no payoff until a new provider;
  do it as part of that work.

## Appendix — touch points for future phases
- ally-be: `prompt.entity.ts`, `create/update-prompt.dto.ts`, `prompt-response.type.ts`,
  `prompt-shared.service.ts` (`getPromptsByOptions`), `ai.service.ts` (`getPromptOverrides`),
  `scenario-shared.service.ts` (`getPromptsForScenarioSession`), `ai.request.dto.ts`
  (`PromptOverride`), `learn/constants/autofill-models.constants.ts`.
- ally-ai-learn: `app/llms/factory.py` (`create_llm_client`, `infer_provider_from_model`),
  `app/core/agent/factory.py` (`build_llm_client_for_prompt`, `configure_llm_client`,
  `resolve_call_site_llm_client`), `app/core/scenario/base.py` (`PromptData`).
- ally-ai: `app/prompts/resolver.py` (`get_backend_llm_overrides`),
  `app/core/text_generations/openai_text_generation_client.py` (`get_or_create_client`,
  `_is_openai_model`), `openai_text_generation_service.py` (`_client_for`, `_invoke_llm`).
- ally-web: `constants/models.ts` (`PROMPT_LLM_MODEL_OPTIONS`),
  `components/prompt-side-panel/PromptSidePanel.tsx`.
