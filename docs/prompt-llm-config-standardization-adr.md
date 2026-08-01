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

### New decision: the model catalog moves to the DB; the provider matrix stays in code

> **Revised later the same day.** This section first concluded "the catalog stays in code"
> wholesale. That was too broad: it treated five fields as one thing. The corrected split
> is below; the original objection survives for exactly one field.

`LLM_MODEL_REGISTRY` bundles three different kinds of fact:

| Field | What it actually is | Home |
|---|---|---|
| `provider` + `model` + `label` | Pure data. Adding `gpt-5.1-mini` under OpenAI needs **no code change** — the client is constructed from a provider and a model string | **DB** |
| `supportsTemperature` | Not a code capability: a prefix guess over the model name (`o1`/`o3`/`o4`/`gpt-5`) in `modelSupportsTemperature`. A fact about the model that we infer, badly | **DB**, seeded from the heuristic |
| `runtimes[]` | A genuine property of deployed code — ai-learn's `app/llms/factory.py` has OpenAI/Gemini/Ollama/vLLM branches and no Anthropic; `PromptSidePanel.tsx` hardcodes `PROVIDER_ORDER` to OpenAI + Gemini | **Code** |

**Refinement:** `runtimes` should not be stored per model at all — it is a property of the
*provider*. Every OpenAI model runs wherever the OpenAI client is wired. Keep a small
in-code provider×runtime matrix (3 runtimes × ~5 providers, changing perhaps twice a year)
and derive a model's runtimes from its provider. Then:

- adding a **model** is pure data — no deploy;
- adding a **provider** is a code change, which is correct, because it is one.

Storing `supportsTemperature` is safe in both directions: `resolveTemperature` omits the
value when false, and ai-learn drops a temperature the model rejects rather than 400-ing.
A human correcting a bad guess without a deploy is strictly better than the heuristic.

**The objection that survives** applies only to provider→runtime. In
`app/llms/factory.py` (~L99):

```python
if "model" not in config_dict and not is_local_provider:
    config_dict["model"] = DEFAULT_LLM_CONFIG["model"]
```

A config naming a provider the runtime cannot serve keeps that provider and acquires the
*platform default model* — a silently wrong client, not a visible failure. Hence the
provider matrix stays in code: an admin may add any model under a provider the runtime
already speaks, but cannot invent a provider nothing can build.

**Costs accepted:**
- The catalog becomes **environment-specific**. Today it is versioned with the code and
  identical everywhere; in the DB, dev and prod can diverge. The seed migration covers day
  one; the liveness probe must report per environment so drift is visible.
- The endpoint needs a **fallback to the in-code list** when the table is empty or the
  query fails, or a single bad migration empties every model picker in the product.

**Shape:** a new `llm_models` catalog table, *not* an extension of `llm_configs`. They have
different cardinality and meaning — `llm_configs` is "a named config a language points at"
(several may share one model at different temperatures), `llm_models` is "this model exists
and is selectable". The liveness probe checks models, deduped; overloading one table would
make it re-check the same model once per referencing config.

`GET /api/v1/llm/models` keeps its exact response contract, merely DB-backed with the
provider matrix joined in, so `ally-web` needs no change.

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
`monthly` bucket is needed (`@Cron('0 0 3 1 * *')` → `runTasksForInterval('monthly')`).
Cadence is deliberately monthly, not daily: deprecations carry long lead times, and 4a
gives an on-demand check for the moment something looks wrong. The accepted cost is up to
a month of not knowing.

Once 4b lands on top of the `llm_models` catalog, availability state
(`availability`, `lastCheckedAt`, `lastCheckError`, `consecutiveFailures`) belongs on the
catalog row — one place per model, rather than scattered across every config, prompt and
language that references it.

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
| 2 | `llm_models` catalog table, seeded from `LLM_MODEL_REGISTRY`; endpoint reads DB with the in-code list as fallback; provider×runtime matrix stays in code | Low–Medium |
| 3 | 4b liveness probe, alert-only, monthly | Low |
| 4 | Reconcile `google`/`gemini`; validate `llm_configs` against the catalog | Medium — touches resolution |

Step 2 replaces the earlier "seed `llm_configs` from the catalog" item: with a real catalog
table there is nothing to duplicate into `llm_configs`, which goes on holding *choices*.
Any picker offering catalog models to a language must still filter by the derived
`runtimes`, or it will offer Anthropic models that ai-learn cannot run.

Step 4 stays last: it touches the resolution path shipped in `1875000000001`, and it has
the same hazard shape as the voice-provider casing migration that had to be reverted — a
stored value the client's dropdown cannot match, where saving silently rewrites the field.

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
