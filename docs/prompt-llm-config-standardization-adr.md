# ADR: Standardizing per-prompt LLM config (model + temperature) across services

- **Status:** Accepted — Phases 1 and 2 implemented; Phase 4 (model-liveness) proposed
- **Date:** 2026-06-30
- **Last updated:** 2026-08-01 (see [Update — 2026-08-01](#update--2026-08-01))
- **Scope:** ally-be, ally-ai-learn, ally-ai, ally-web
- **Decision owners:** Platform / AI

> **Reading note.** The Context and Decision sections below are the original
> 2026-06-30 record and are deliberately left intact. Several of their factual
> claims no longer hold — each is marked inline. The current state of the world
> is the [Update — 2026-08-01](#update--2026-08-01) section.

## Context

We shipped per-prompt **model + temperature** overrides: an author sets them on a
prompt/skill in Studio → Prompt Management, and the runtime that consumes that
prompt applies them. It works and is tested, but it was implemented as **three
independent ad-hoc integrations**, one per consuming runtime.

### Current state (inventory)

**Storage + delivery (ally-be)**
- `prompts.model` (varchar) + `prompts.temperature` (numeric) columns
  (`1818000000000-AddModelAndTemperatureToPrompts` — the original text cited
  `1796000000000`, which is not the migration in the repo).
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
   *(Resolved in Phase 1 — see Update.)*
2. **Provider inferred from model name** — fragile: a fine-tuned/custom model id, or a
   new provider whose names don't match known prefixes, resolves wrong or not at all.
   The prompt stores only `model`, never `provider`.
   *(Superseded: `prompts.provider` now exists and inference is a fallback — see Update.)*
3. **No capability awareness** — the UI offers a temperature slider for every model,
   but some models (o-series, some gpt-5 variants) reject a non-default temperature.
   *(Resolved — `supportsTemperature` is served by the registry and the ai-learn factory
   drops an invalid temperature rather than 400-ing.)*
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

- **Phase 0 (now):** this ADR. — **DONE**
- **Phase 1 (when list drift hurts):** model registry endpoint + point `ally-web` at it.
  Additive, low risk. No runtime changes. — **DONE** (`LLM_MODEL_REGISTRY`,
  `GET /api/v1/llm/models`; the ally-web lists are now fallbacks only)
- **Phase 2 (when adding the next provider, e.g. Anthropic):** add `provider` to the
  prompt config + delivery + each consumer; drop prefix inference; add the provider
  branch to whichever runtime factories need it. Add `supportsTemperature` gating.
  — **LARGELY DONE** (`prompts.provider`, `getPromptOverrides` carries provider,
  `create_llm_client(provider_override=…)`; prefix inference retained as a fallback)
- **Phase 3 (only if churn justifies):** extract a tiny shared "resolve config →
  (provider, model, temperature)" helper reused by the runtimes. Skip the full client
  unification. — **NOT STARTED** (churn has not yet justified it)
- **Phase 4 (proposed 2026-08-01):** model liveness — preview endpoint + scheduled
  probe, alert-only. See the Update section.

## Update — 2026-08-01

Phases 1 and 2 have shipped. A new trigger has arrived that the original ADR did not
anticipate: **model deprecation**, rather than a new provider.

### What shipped

**Phase 1 — model registry (done).**
- `src/llm/constants/llm-model-registry.constants.ts` — `LLM_MODEL_REGISTRY`, with
  `provider`, `model`, `label`, `supportsTemperature`, `runtimes[]`.
- Served by `GET /api/v1/llm/models` (`src/llm/controller/llm.controller.ts`), optionally
  filtered by runtime.
- `ally-web` consumes it via `useGetLlmModelsQuery`. The old hand-maintained lists
  (`PROMPT_LLM_MODEL_OPTIONS`, `FALLBACK_AUTOFILL_MODEL_OPTIONS` in `constants/models.ts`)
  survive **only as degraded-mode fallbacks** — `llmModels?.length ? … : FALLBACK`.

**Phase 2 — explicit provider (largely done).**
- `prompts.provider` exists ('openai' | 'gemini' | 'anthropic'); null means "infer from
  the model", so it is backward compatible.
- Delivered to ally-ai through `getPromptOverrides()` as `{provider, model, temperature}`.
- ai-learn's `create_llm_client` takes a `provider_override`; `infer_provider_from_model`
  is now the *fallback*, not the primary path.

**Not anticipated by the original ADR:** per-language LLM config moved out of the
`languages.llmProviderConfig` jsonb column into an `llm_configs` registry table
(`1875000000001-CreateLlmConfigsRegistry`), with the jsonb retained as a fallback rung.
Resolution is now: language `llmConfigId` → legacy jsonb → platform default.

### New decision: the capability catalog stays in code

A natural next step is "make every model configurable from the admin dashboard, like
voices". **We are explicitly not doing that**, because `LLM_MODEL_REGISTRY` and
`llm_configs` answer two different questions:

| | Question | Where it belongs |
|---|---|---|
| Capability catalog | *What can the deployed code run?* | Code (`LLM_MODEL_REGISTRY`) |
| Deployment choice | *What should this language / prompt use?* | DB (`llm_configs`, `prompts.model`) |

`runtimes[]` and `supportsTemperature` are properties of deployed code, not configuration.
Anthropic is `ALLY_BE`-only because ai-learn's `app/llms/factory.py` has no Anthropic
branch; `PromptSidePanel.tsx` hardcodes `PROVIDER_ORDER` to OpenAI + Gemini for the same
reason. They change when someone writes code, and they must ship and roll back with it.

The failure mode if the catalog moved to the DB is not a clean error. In
`app/llms/factory.py` (~L99):

```python
if "model" not in config_dict and not is_local_provider:
    config_dict["model"] = DEFAULT_LLM_CONFIG["model"]
```

A config carrying a provider the runtime cannot serve keeps that provider and acquires the
*platform default model* — so an admin selecting an unrunnable model yields a silently
wrong client, not a failure anyone notices. A reviewed in-code list is strictly safer.

**Instead:** validate the DB choice against the catalog, and filter the language-level
picker by `runtimes` so an unrunnable model is never offered.

### Known defect — provider vocabulary disagreement

The two registries do not share a provider vocabulary:

- `LLM_CONFIG_SCHEMA` (for `llm_configs`) accepts `openai | google | gemini | ollama | vllm`
- `LLM_MODEL_REGISTRY` uses `openai | gemini | anthropic`

`google` vs `gemini` currently works only because `infer_provider_from_model` maps *both*
prefixes to `GEMINI`. That is an accident, and it must be reconciled before validation is
built on top of it. `ollama`/`vllm` are absent from the catalog entirely (they are local
runtimes with no model list), so any validation needs an explicit exemption for them.

### Phase 4 (proposed) — model liveness

The original phases cover *drift between our own lists*. They do not cover **a provider
retiring a model we depend on**, where today the first signal is a production failure.

**4a — LLM preview endpoint.** Mirror `src/voice-preview/`: `POST /api/v1/llm/preview`
runs a trivial completion against a stored config and returns text, latency, token usage,
or the provider's error, with a test button beside each registry row. This exercises the
real credential and the real call path, which a model-list API never does. All three SDKs
(`openai`, `@anthropic-ai/sdk`, `@google/genai`) are already dependencies.

**4b — scheduled liveness probe.** Register a task in `scheduledTaskRegistry`
(`src/scheduler/`), which already provides interval buckets and a Postgres advisory lock
so only one replica runs a tick. Only 5min/15min/30min/hourly buckets exist today, so a
`daily` bucket is needed. For every model actually in use — `llm_configs` rows,
`prompts.model`, legacy language jsonb — check the provider's model list and run a small
live call.

**Alert; do not auto-disable.** Auto-disabling an in-use model converts a future problem
into an immediate outage: marking `gpt-4o-mini` unavailable would break every English
session now rather than whenever OpenAI actually withdraws it. Absence from a list API is
also not proof of unusability — providers keep serving de-listed models, and a transient
5xx or auth blip would flag everything at once. Therefore:

- an `available: false` flag hides a model from **new** selections and badges rows using
  it; it never stops existing usage;
- the alert names the exact languages and prompts affected, so the fix is obvious;
- require *consecutive* failures before flagging, and never flag on a transport error —
  only on an authoritative "model not found".

### Suggested sequence

| Order | Work | Risk |
|---|---|---|
| 1 | 4a preview endpoint + test button | Low — additive, no schema change |
| 2 | 4b liveness probe, alert-only | Low |
| 3 | Reconcile `google`/`gemini`; validate `llm_configs` against the catalog | Medium — touches resolution |
| 4 | Seed `llm_configs` from the catalog, filtered by `runtimes` | Low |

Step 4 is safe only with the runtime filter: seeding a row per catalog model would put
Anthropic models, which ai-learn cannot run, straight into the language picker — the
failure this update exists to prevent.

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

### Appendix — touch points added 2026-08-01

- ally-be registry/serving: `llm/constants/llm-model-registry.constants.ts`,
  `llm/controller/llm.controller.ts`, `common/util/llm-model.util.ts`
  (`modelSupportsTemperature`).
- ally-be per-language registry: `learn/entity/llm-configs.entity.ts`,
  `learn/service/llm-config.service.ts`, `learn/util/scenario.util.ts`
  (`resolveSessionLlmConfig`), `learn/constants/provider-config-schemas.constants.ts`
  (`LLM_CONFIG_SCHEMA`).
- Phase 4 scaffolding to reuse: `src/voice-preview/` (provider factory + per-provider
  clients — the shape to mirror for `llm/preview`), `src/scheduler/`
  (`scheduled-task.registry.ts`, `scheduled-task-runner.service.ts` — interval buckets
  and the multi-replica advisory lock).
- ally-web pickers to keep in sync: `components/autofill-model-select/`,
  `components/enhance-button/`, `pages/AILab/AutoEvalDrawer.tsx` (all fall back to
  `FALLBACK_AUTOFILL_MODEL_OPTIONS` when the registry call returns nothing).
