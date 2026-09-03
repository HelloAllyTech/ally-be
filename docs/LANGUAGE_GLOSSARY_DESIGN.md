# Language Glossary for the Live Agent (Indian Languages)

**Status:** ✅ **Phase 1 complete** (2026-07-22) — ally-be commit `df052b95` on master
(GL-1…GL-6): migrations `1859000000000-CreateLanguageGlossarySections` +
`1861000000000-AddGlossaryGenerationPrompt` (+`1860` Telugu llmProviderConfig fix,
renumbered from 1856-1858 after a timestamp collision with a remote 1856);
`LanguageGlossarySection` entity/repo; glossary compiler + o200k_base token guard
(`gpt-tokenizer` dep, cap enforced on publish AND edits of published always-sections);
lifecycle API `GET/PUT /v1/language/:id/glossary[/:sectionCode]` +
`POST …/publish|archive|generate`; seed job **verified end-to-end against real Gemini
for Tamil** — 5 sections, colloquial-register pairs (நீங்க vs நீங்கள்), kinship
agreement rules, Tier 0 compiled at ~591 tokens. Full suite green (267/4282).
Decisions #10/#11 resolved (English-scaffolded entries; `organizationId` nullable, NULL
in v1).

**Phase 2 complete** (2026-07-22) — ally-be `9ea41d62` + ally-ai-learn `dfa5291`:
`createRoomMetadata` ships `promptData.languageGlossary` (published always-sections,
non-English only, failure never blocks a session; publishing a section IS the rollout
gate) + room-metadata size telemetry (`[ROOM_METADATA_SIZE]`, warn ≥48 KiB — edge case 11
downgraded from "measure first" to live telemetry; local scenarios max ~2 KB);
ai-learn renders `{language_glossary}` in main/full/branching templates (+ meta), kwarg
always passed so override bodies without the placeholder are unaffected. Tests: ally-be
61 scenario-shared (3 new) + full suite; ai-learn 1174 unit (4 new).
**Phase 2 addendum** (ai-learn `de86b45`): system-level glossary append in
`generate_system_message` (`_ensure_language_glossary`, same pattern as
`_append_audio_tag_guidance`) — dashboard-override bodies, legacy per-language variant
rows, and translated bodies get the style card appended under a "## Language style
guide" header without any Prompt Management edits; templates that render the
placeholder keep placement control (verbatim-presence guard prevents duplication).
**Phase 3 complete** (2026-07-22) — ally-web `4adf3583`: glossary manager at
`/manage-scenario-languages/:id/glossary` (super-duper-admin, same gate as Languages) —
master-detail editor, per-type entry rendering (term-pair table / rule / pattern cards),
inline Accept/Reject for proposed entries, Tier 0 token meter, save/publish/archive/
generate actions; RTK endpoints under new `LANGUAGE_GLOSSARY` tag; "Manage glossary"
link on the Language side panel. Full FE suite green (141 files / 3190 tests); app
boot + route redirect verified in browser (editor walkthrough needs an authenticated
session — preview on :8081).
**Phase 5 complete** (2026-07-22) — ally-be `fbaade74` + ally-ai-learn `3f3d212`:
`resolveTier1Sections` ships published retrieved-mode sections as
`promptData.glossarySections` (titles prefixed `[<label> glossary]`); ai-learn merges
them into the title-selection knowledge map (retrieval now also runs for
glossary-only sessions), with the **dual-framing selector prompt** (§5.2: scenario
topics = discussed; glossary sections = what the NEXT reply needs, inclusion-biased)
and `retrievalHint` rendered under each glossary title; hints participate in the LRU
cache key. Existing caps/gates/timeout unchanged; selector prompt byte-identical when
no glossary sections present. Tests: ally-be 117 across the two suites; ai-learn 1182.

**Phase 0 RESOLVED via prod dashboard (2026-07-22) — routing IS broken.** The prod
Tamil `languages` row shows `llmProviderConfig = openai / gpt-4o-mini` (not the
Gemini config migration 1768… seeded; local DB still has gemini-2.0-flash-exp). Every
prod Tamil session's main agent has been gpt-4o-mini — likely a dominant contributor
to failure mode #2. The checked main_agent prompt row has "LLM Model: Default
(inherit)" (hazard #2 clear for it; legacy Tamil/Kannada variant rows still to check).
Prod STT chirp_2 on the Tamil row is correct (STT box, unrelated to the Telugu LLM bug).
Prod prompt variables don't yet include `{language_glossary}` → Phases 2/5 not yet
deployed to prod.
**Team decision (2026-07-22): Tamil-on-OpenAI is deliberate; a Gemini switch may come
later.** Consequences: (a) the current Tamil-on-gpt-4o-mini state IS the eval baseline —
publish the glossary and measure a single-variable delta; a later model switch is its
own re-baseline event; (b) keep Tamil's Tier 0 card lean (~1k tokens, not the 2k cap) —
mini models gain the most from explicit constraints but are most prone to instruction
dilution; keep register policy + code-mixing + kinship rules in Tier 0, push marginal
term pairs to retrieved sections; (c) expect the glossary to move dialect_lexicon/
colloquialness and pronoun errors; raw syntax coherence is mostly the model — re-check
that number if routing ever flips to Gemini.

**Phase 4 + backfill complete** (2026-07-22) — ally-be `10563413`, ally-web `4630190f`:
`POST /v1/language/glossary/backfill` (all active non-English, or given ids; per-language
failures recorded) + `POST /v1/language/:id/glossary/consolidate` — judge annotations
(style dimensions only, conditioned-out excluded, cross-tenant by design) → PROPOSED
entries via the `glossary_consolidation` registry prompt (migration 1862), with
per-entry `provenance.annotationIds`, consumed-set incrementality, and normalized
dedupe. Verified E2E vs real Gemini: 4 seeded Tamil annotations → 2 generalized
proposals (one rule merged two diglossia annotations), 1 duplicate skipped, re-run
proposed 0. UI: "Run consolidation" on the glossary manager; "Generate glossaries
(all)" on the Languages page. Known bounded behavior: an annotation whose proposal
deduped away is reconsidered each run (its id is never recorded) — harmless, dedupe
re-catches it.

**Anti-tutor framing** (ai-learn `5bea24e`): both glossary delivery paths wrap the card
in shared framing — "Private rules for how YOU speak… apply silently… never mention,
quote, teach, or correct anyone's language — you are the client, not a language tutor."
Judge `persona_social` + first-session spot-checks are the empirical backstop.

**Rollout switches (deploy is inert):** publishing a section is the only enable; the
hierarchy is per-language (publish/archive its sections), per-tier (archive always vs
retrieved), per-section — all UI-driven, next-session effective (mid-flight sessions
keep their start-time metadata). Optional global env kill switch in ally-be not built —
add only if wanted.

**Markdown pivot** (2026-07-22, admin feedback: structured editor too heavy) — ally-be
`6e209664`, ally-web `b455920d`: sections are now plain markdown (`content` column,
migration 1863 backfills typed entries and repurposes `entries` as consolidation
proposals only `{id, markdown, status proposed/accepted/rejected, provenance}`). What
admins write is what agents get (`## title` + content verbatim) — the runtime always
received markdown, so ai-learn is untouched. Accept appends the proposal's markdown to
content (Tier 0 cap enforced); both review outcomes keep the row so the consumed-set
holds. Prompt v2 bodies (generation + consolidation) emit markdown natively — verified
vs real Gemini (3 draft Tamil sections regenerated as clean colloquial markdown,
published sections skipped, Tier 0 591/2000 tok). UI: one markdown textarea per section,
amber proposals inbox beneath it, Generate/Consolidate actions moved from the page
header into the Sections rail footer. This supersedes §4's typed-entries schema and
§8's per-type editors.

---

### Post-July: the loop went unattended (2026-08-20 → 2026-09-03)

Everything below postdates the original body of this document. **§6, §8 and §9 as
originally written describe a human-in-the-loop curation pipeline that no longer exists** —
they have been rewritten in place; §4 carries a supersession note.

**Phase 6 — variety profiles & overlays** (`language_variety_profiles`,
`GET/POST /v1/language/:id/variety-profiles[/infer]`). A language is not one variety: `ta`
in practice means DEMCARES, `kn` means KHPT, `hi` means Sangath. A profile carries its own
feature set, and a glossary section may exist as a **profile overlay**
(`sectionCode` + `profileId`) that OVERRIDES the global counterpart at runtime.
Consolidation routes a proposal to an overlay when every supporting tenant maps to the same
profile, and global when support spans profiles.

**Phase 7 — the construct-class pipeline.** Linguistics proposes, statistics disposes.
Annotations are typed by construct class (`construct-class.util.ts`), clustered by evidence
similarity within (construct, category), and clusters below
`GLOSSARY_MIN_CLUSTER_SUPPORT` (2, adaptive for thin languages) never reach the LLM.
`fluency` is admitted only through a systematicity gate (`GLOSSARY_SYSTEMATIC_MIN` = 5) —
a one-off grammar slip is model competence; a recurring category is a correctable rule.
Lexicon proposals are scored against the real learner corpus and a `contradicted` verdict
(`GLOSSARY_LEXICAL_CONTRADICTION_MIN` = 5) blocks auto-accept: never fight real usage.

**Phase 8 — automated tiering.** `computeTierAssignment` replaced `importance` with a
density knapsack: sections rank by (term traffic + severity-weighted error mass) per token,
Tier 0 is the prefix that fits `TIER0_TOKEN_CAP`. Pins win unconditionally; a
`TIER_HYSTERESIS` (0.15) incumbent bonus prevents tier flapping. `POST
/v1/language/:id/glossary/retier`. **`importance` is now write-only** — stored, never read.

**Phase 9 — deterministic adherence.** `glossary_adherence_reports` scans agent utterances
for published `(avoid: …)` terms per session — judge-independent, so it stays valid even
when the judge is wrong. `violationsPer100AgentMessages` is the honest denominator;
`avgViolationsPerSession` is retained but misleading. Endpoints under
`…/glossary/adherence[/backfill]` and `…/glossary/adherence/overview`.

**Phase 10 — unattended adjudication** (supersedes decision #5's "humans approve").
There is no reviewer who reads Tamil, Kannada, Hindi and Marathi, so `propose` meant the
queue grew forever. `GlossaryAdjudicationService` decides it hourly. See §6.3.

**Phase 11 — impact analytics.** `GET /analytics/glossary-effect`, grain
`(language, period, agentModel)`, per-language go-live derived in SQL from the first
`published` section, judge tuple pinned. The grain is the point: earlier aggregate impact
figures dissolved once traffic-mix and model changes were segmented out.

**Consolidation stall (fixed 2026-09-02/03, ally-be v1.82.11–v1.82.22).** The 200-row
annotation window counted CONSUMED rows, so the consumed-set spent the whole budget:
Tamil exposed 13 of 2,409 unconsumed annotations and nothing consolidated for 8 days
across every language. Fixed by excluding the consumed-set in SQL **before** the limit.
Shipped alongside: a 90-day recency bound (`GLOSSARY_CONSOLIDATION_RECENCY_DAYS`), a
foreign-script filter (`excludeForeignScripts` — 8 queued proposals had been Tamil rules
under `en-IN`), three-layer duplicate suppression, an empty-batch record so the cadence
clock advances, `en` judge-language normalization, and the weekly cadence in §6.2.

**Live state (2026-09-03).** Five languages have glossaries (en, ta, kn, hi, mr) — not
Tamil-only as decision #9 says. `GLOSSARY_CONSOLIDATION_SCHEDULE=propose`,
`GLOSSARY_ADJUDICATION_SCHEDULE=apply`, ally-be v1.82.22, task definition rev 373.
Measured: −27% avoid-term violations; −8% judge naturalness for Tamil over 869 turns
(the only per-language figure with enough real-org traffic to defend). Three Tamil
proposals sit deferred at 2,065/2,000 Tier 0 tokens — see §13.
**Phase 0 code trace done:** ally-be embeds `llm: languageDetails.llmProviderConfig`
top-level in room metadata (`scenario-shared.service.ts:627-630`, empty config falls back
to openai/gpt-4o-mini via `STT_LLM_PROVIDER_CONFIG`); ai-learn reads it (`base.py:859`)
BUT a `model` set on the `main_agent` prompt row **overrides the per-language provider**
(`factory.py` precedence) — prod check must cover both the `languages` row and main-agent
prompt rows. Local DB: ta-IN correctly google/gemini-2.0-flash-exp; **te-IN bug found**
(llm config holds STT model `chirp_2`, from migration 1768392581395 → prod affected;
fix spun off separately). Prod verification pending fresh AWS credentials.
**Author:** gopi.s@helloally.ai (with Claude)
**Scope:** v1 Simulation / live voice agent (ally-ai-learn) + prompt/language config
(ally-be, ally-web admin dashboard). Roleplay Studio v2 out of scope.
**Companion:** builds on `PROMPT_TRANSLATION_DESIGN.md` (translated `main_agent`/`branching`
templates — shipped) and shares its Gemini scaffolding. That doc is still at the *workspace*
root and still unversioned; it has the same drift exposure this one had until 2026-09-03.
**Location:** this file moved from the workspace root to `ally-be/docs/` on 2026-09-03 (§13.7).

---

## 1. Goal

Agents speaking Indian languages exhibit recurring language-quality failures:

1. **Register mixing (diglossia)** — literary Tamil for clinical discussion, colloquial Tamil
   for informal talk, inside one conversation.
2. **Broken syntax / grammar** → incoherent speech.
3. **Wrong grammatical agreement** — e.g. he/him or this/that pronouns for the character's
   mother.

We already ship translated prompt templates, per-scenario `linguisticStyleSamples`,
`allowedFillerWords`, and free-text `languageCharacteristics`. The next layer is a
**per-language glossary**: a compact "how to speak X" reference (inspired by the <100-page
spoken-English booklets sold on Indian public transport) injected into the main agent's
context.

**Framing that shapes the whole design:** the LLM *half-knows* these languages. The glossary
does not teach the language — it **constrains and corrects** a language the model partially
knows. That reframing is why <100 pages is not just sufficient but more than we can use:
the binding constraint is the in-context token budget of a latency-sensitive voice loop,
not the size of the reference material.

### 1a. Failure-mode → mechanism map (what a glossary can and can't fix)

| Failure | Root cause | Glossary fix | Fit |
|---|---|---|---|
| Literary/colloquial register mixing | Clinical topics pull the model toward the formal register its training data associates with medical text. `languages.evalConfig` already models `diglossia`. | Term pairs: "say this (colloquial), not this (literary)" for clinical/emotional vocabulary. Must be active **every turn** — retrieval will miss the moment the conversation turns clinical. | ✅ Best fit |
| Wrong pronouns/agreement for female kin | Grammatical-agreement weakness, amplified by model size (default main agent is `gpt-4o-mini`, `ally-ai-learn/app/core/constants.py:85`). | Standing rule + 2–3 example sentences in the always-on block. Rules-plus-examples beats rules alone for LLMs. Not retrievable — it matters on every turn. | ✅ Good fit |
| General broken syntax | Model competence at low-resource grammar. LLMs pattern-match to **examples** in context; they do not internalize grammar rules the way the booklet's human reader does. | Exemplar sentences in target register (extends `linguisticStyleSamples`), not conjugation tables. | ⚠️ Partial — bigger levers are the shipped prompt translation ("thinking" in the language) and per-language model routing (`languages.llmProviderConfig` already maps most Indian languages to Gemini; **verify prod Tamil sessions actually use it** — see §13) |

---

## 2. Decisions

| # | Decision | Choice | Status |
|---|----------|--------|--------|
| 1 | Where the glossary lives | **Language-level in ally-be** (new `language_glossary_sections` table), NOT per-scenario `knowledgeSources`. A glossary is cross-scenario; scenario storage would duplicate it into every scenario, fight the 2500-char/source cap, and require N scenario edits per fix. | Locked |
| 2 | Delivery shape | **Two tiers.** Tier 0 "style card" (`injectionMode='always'`, ~1–2k token budget): concatenated into the system prompt every turn via a new `{language_glossary}` placeholder. Tier 1 topical sections (`injectionMode='retrieved'`): merged into the existing knowledge-retrieval title-selection path. | Locked |
| 3 | Transport | Same channel as everything else: ally-be embeds resolved glossary text into **LiveKit room metadata** at session start (`scenario-shared.service.ts` → `createRoomMetadata`). The live agent never fetches over HTTP mid-session. | Locked |
| 4 | Runtime retrieval mechanism | **Piggyback** on existing LLM title-selection (`knowledge_retrieval.py`): glossary sections join the knowledge map with prefixed titles + per-section `retrievalHint`, and the selector prompt gains a **dual-framing instruction** — glossary sections are selected for what the agent's *next reply* needs (production-side, forward-looking), not for what is being discussed (§5.2). **No second retrieval call, no new latency, no embeddings/Weaviate.** | Locked |
| 5 | Curation | Ingest→consolidate loop (pattern from GCP `always-on-memory-agent`, stack NOT adopted): judge error annotations accumulate as raw instances; a scheduled job consolidates them into deduplicated, evidence-gated **proposals**. ~~humans approve~~ → **an LLM adjudicator decides them unattended** (§6.3); no reviewer exists for ta/kn/hi/mr. Weekly per language, floored at 24h. | **Revised 2026-09-02** |
| 6 | Seeding | LLM-generated first draft per language via the existing Gemini scaffolding (`LlmProviderFactory` path from the translation project), through a registry prompt row (`glossary_generation`) editable in Prompt Management. Native-speaker review before publish. | Locked |
| 7 | Precedence | Language glossary (global) < scenario `languageCharacteristics` (per-scenario free-text override) — stated explicitly in the prompt so scenario-specific dialect tweaks win. | Locked |
| 8 | Evaluation | Two signals, deliberately: (a) the LLM language judge — per-category error-rate deltas, pinned `judge_version`, spot-checks, **no hand-labeled sets, no κ gates**; (b) a **deterministic** avoid-term adherence scan (§9), which is judge-independent and therefore the one signal that survives a judge error. Both segmented by `agentModel` via `/analytics/glossary-effect` — unsegmented deltas are traffic-mix artefacts. | **Extended 2026-08** |
| 9 | v1 language + tier | ~~Tamil first, Tier 0 only~~ → **five languages live** (en, ta, kn, hi, mr); Tier 1 retrieved sections shipped in Phase 5. English's glossary went live 2026-08-20, materially later than the rest — never apply one go-live date across languages when reading impact. | **Superseded** |
| 10 | Entry language | **English scaffolding + native-script examples** — reviewable by non-native admins, cheaper in tokens. | Resolved 2026-07-22 |
| 11 | Tenant scope | Global per language; `organizationId` nullable and NULL in practice. Per-population scoping arrived instead as **variety-profile overlays** (`profileId`), which are linguistic rather than contractual — the right axis. | Resolved 2026-07-22; extended Phase 6 |

---

## 3. Scope

**In scope**
- New `language_glossary_sections` table + CRUD + admin UI tab on the Language side panel.
- Tier 0 injection into `main_agent` and `branching` prompts (one new placeholder each).
- Tier 1 merge into the existing knowledge-retrieval path (later phase).
- Consolidation job proposing draft entries from `language_error_annotations`.
- Absorbing/superseding the hardcoded proto-glossary
  (`CODE_MIXING_PRESERVE_WORDS`, `LANGUAGE_TONE_GUIDELINES` in
  `ally-be/src/common/constants/translation.constants.ts`) so the live agent and both
  translation pipelines share one source of truth. The prompt-translation design already
  flags cross-engine tone clash (§11.8 there); this closes it.

**Out of scope (v1)**
- Roleplay Studio v2.
- Embeddings/vector retrieval (Weaviate belongs to ally-ai's `reference_documents`; not wired here).
- Session memory ("what happened") — glossary is language competence ("how to speak");
  `previous_memory` already covers the former.
- Grammar-critic post-processing of agent output — too slow for the voice loop; track via judge instead.
- Per-scenario glossary overrides beyond the existing `languageCharacteristics` free text.

**Latency constraint (hard, shapes everything):** the voice loop (STT → LLM → TTS) must stay
near ~1–1.5 s. Per-turn prompt assembly happens in
`ally-ai-learn/app/core/graph/prompt.py` (`generate_system_message`, called from
`generate_response`, `nodes.py:1110`); knowledge retrieval is one parallel LLM
title-selection call with an 8 s timeout, LRU cache, 1500-char/match + 8000-char total caps
(`knowledge_retrieval.py:26-27`). The design adds **zero** LLM calls to the hot path.
Tier 0 costs only ~1–2k tokens of prefill on a stable prompt prefix (prompt caching absorbs
most of it). Note Indic scripts tokenize at ~2–4× tokens/word on OpenAI tokenizers — the
Tier 0 budget is measured in tokens, not characters, and the UI must show it (§8).
A read-the-whole-store QueryAgent pattern (as in the GCP memory-agent repo) is explicitly
rejected for the runtime path.

---

## 4. Data model (ally-be, owns Postgres)

> **Superseded in part.** The markdown pivot (see Status) replaced typed entries with a
> plain `content` column, and Phase 6 added `profileId`. The column list below is current
> as of 2026-09-03; the *typed entry* schema that followed it has been removed. Canonical
> source: `ally-be/src/language/entity/language-glossary-section.entity.ts`.

Table **`language_glossary_sections`** (a table, not jsonb on `languages`: sections are
edited/reviewed independently, tiering is per-section, and proposals need provenance):

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `languageId` | int FK → `languages` | |
| `organizationId` | uuid nullable | NULL = global (v1 always NULL); reserved for per-org clinical terminology (§13) |
| `sectionCode` | text | e.g. `core_style`, `pronouns_kinship`, `clinical_terms`, `emotions`, `smalltalk` |
| `title` | text | **what the retrieval LLM sees** for Tier 1 — must be self-describing |
| `profileId` | uuid nullable | **Phase 6.** NULL = global; set = a variety-profile *overlay* that OVERRIDES the global counterpart at runtime |
| `content` | text | the section body as **plain markdown** — what admins write is what agents get, rendered verbatim under `## title` |
| `entries` | jsonb | **consolidation proposals only** (`{id, markdown, status, importance?, adjudication?, provenance}`); accept appends `markdown` to `content`, and both outcomes keep the row so the consumed-set holds |
| `retrievalHint` | text nullable | Tier 1 only — one line of "when to pull this" trigger conditions, shown to the retrieval selector under the title (e.g. "retrieve when the conversation is turning toward diagnosis, symptoms, medication, or therapy concepts") |
| `injectionMode` | enum | `always` \| `retrieved` — the tiering switch |
| `status` | enum | `draft` \| `published` \| `archived` — runtime serves `published` only |
| `tierPinned` | boolean | **Phase 8.** An admin pin; `computeTierAssignment` honours it unconditionally — automation amplifies judgement, it does not overrule it |
| `importance` | int nullable | ⚠️ **write-only since Phase 8.** Clamped, stored, never read. Tier 0 placement comes from the density knapsack, not this column |
| `provenance` | jsonb nullable | e.g. `{source: 'consolidation', annotationIds: [...]}` or `{source: 'seed'}` |
| `version` | int | bump on content change |
| `createdBy` / `updatedBy` | | audit |
| `createdAt` / `updatedAt` | timestamptz | |

- Unique `(languageId, sectionCode, organizationId)`. Index `(languageId, status, injectionMode)`.
- Mirrors the `prompt_translations` pattern (one live row per key, overwrite on change) —
  familiar shape, no per-version history table in v1.

**Proposal shape (`entries` jsonb)** — the typed `term_pair | rule | pattern` schema was
removed by the markdown pivot. What remains is one object per *proposal*:

```jsonc
{
  "id": "uuid",
  "markdown": "- worry/anxiety: டென்ஷன், கவலை (avoid: பதட்டம்)",
  "status": "proposed" | "accepted" | "rejected",
  "adjudication": { "rejectVotes": 1, "lastRejectReason": "…", "lastRejectAt": "…" },
  "provenance": {
    "source": "consolidation" | "seed" | "manual",
    "annotationIds": ["…"],      // the consumed-set, and the rollback handle
    "tenantIds": ["…"],          // breadth signal → global vs profile overlay
    "batchId": "…",
    "evidence": { "say": "…", "avoid": "…", "sayLearnerCount": 7,
                  "avoidAgentCount": 3, "avoidLearnerCount": 0,
                  "verdict": "confirmed" | "unverified" | "contradicted" }
  }
}
```

`adjudication.rejectVotes` exists because **a reject is permanent**: rejecting keeps the row
`rejected`, so its annotations stay consumed and nothing re-derives the rule. An accept is
reversible through the batch record; a reject is not. The adjudicator is not stable enough
for that asymmetry on one reading — the same Tamil proposal was accepted at 15:00 and
rejected at 16:00 on identical input — so a reject needs
`GLOSSARY_REJECT_VOTES_REQUIRED` (2) **consecutive** votes, and the prompt runs at
temperature 0.

**Companion tables added after the original design:**

| Table | Purpose |
|---|---|
| `glossary_consolidation_batches` | One row per consolidation run: proposals, duplicates skipped, engineering findings, and the **rollback handle** (`POST …/consolidation-batches/:batchId/rollback`). An empty batch is still written, so the cadence clock advances |
| `glossary_adherence_reports` | Per-session deterministic avoid-term violation counts + snippets, attributed to `sectionCode` and the section `version` scanned |
| `language_variety_profiles` | Phase 6: the varieties a language actually has, with feature sets and tenant attachments |

**Raw error instances** (consolidation input) need no new table — `language_error_annotations`
(`ally-be/src/learn/entity/language-error-annotation.entity.ts`) already accumulates them,
and carries more than the original design assumed: `userText`, `aiText`, `evidenceQuote`,
the judge's `reasoning`, plus denormalized `llmModel`/`promptVersion`/`judgePromptVersion`.
Dimensions mined are `GLOSSARY_CONSOLIDATION_DIMENSIONS` — `register`, `dialect_lexicon`,
`colloquialness`, `codeswitch`, `persona_social`, and `fluency` behind the systematicity
gate; `understanding`/`coherence` stay excluded outright. Consumed `annotationIds` are
recorded in `provenance`.

*Note (per local-db workflow): `build` before `migration:run` — the runner reads `dist/`.*

---

## 5. Runtime delivery

### 5.1 Tier 0 — always-injected style card

- **ally-be:** at session start, `getPromptsForScenarioSession` /
  `createRoomMetadata` (`scenario-shared.service.ts`; call sites
  `scenario-session.service.ts:752, 2178, 2579`) resolves
  `published` + `injectionMode='always'` sections for `languageId`, concatenates in a fixed
  section order, and adds the result to room metadata as `promptData.languageGlossary`.
  English/default sessions skip entirely (empty string, zero overhead) — same pattern as
  translated-prompt overlay. **Phase 6:** where a variety-profile overlay exists for the
  session's tenant, its section OVERRIDES the global counterpart of the same
  `sectionCode`.
- **ally-ai-learn:** parse `languageGlossary` into `PromptData`
  (`app/core/scenario/base.py`, `_build_prompt_data` — alongside
  `language_dialogue_samples` at `:647-650`); add a `{language_glossary}` placeholder to
  `app/prompts/system/main_agent_prompt.txt` and `branching_agent_prompt.txt`; populate it
  in `_build_behavior_prompt` `template_kwargs` (`prompt.py:436-524`) and
  `_build_branching_prompt` (`prompt.py:271-289`).
- **Composition with translated templates is free:** translated bodies preserve `{...}`
  placeholders (translation design §6), and `SafeFormatter` (`resolver.py:165`) tolerates a
  missing key — old templates without the placeholder keep working, sessions without a
  glossary render nothing.
- **Budget:** hard target ≤ ~2k tokens for the concatenated Tier 0 block, enforced at
  authoring time (§8), never truncated silently at runtime. Contents: register policy,
  pronoun/kinship agreement rules, code-mixing rules (absorbed
  `CODE_MIXING_PRESERVE_WORDS`), and whichever do/don't sections the tiering knapsack
  selects — ~~by `importance`~~ **by score/token density under the cap** (§6.4), with
  `TIER0_TOKEN_CAP` = 2000 as a hard invariant. Compile order is fixed
  (`GLOSSARY_SECTION_ORDER`) so the prompt prefix stays prompt-cache stable across turns.

### 5.2 Tier 1 — retrieved topical sections *(shipped, Phase 5)*

- ally-be ships `published` + `injectionMode='retrieved'` sections in room metadata as
  additional entries alongside `knowledgeSources`, titles prefixed for disambiguation,
  e.g. `[Tamil glossary] Clinical & therapy terms`.
- ally-ai-learn merges them into the knowledge map in `build_knowledge_map`
  (`knowledge_retrieval.py:38`); the existing title-selection call
  (`retrieve_relevant_knowledge` `:166`), LRU cache, per-state `ragEnabled` gate, and
  1500/8000-char caps apply unchanged. Each glossary section's `retrievalHint` is rendered
  in the index directly under its prefixed title.
- **Dual-framing retrieval instruction (required, not optional).** The current selector
  prompt (`knowledge_retrieval.py:200-207`) asks for topics "directly relevant to what is
  being discussed" — a backward-looking, content-side criterion that fits scenario facts
  but systematically under-selects glossary sections, which are *production* resources:
  relevant when the agent's **next reply** is about to enter a vocabulary domain, even if
  the learner never named it. When glossary entries are present, the system prompt carries
  two criteria in one call:
  - scenario topics: unchanged — "directly relevant to what is being discussed";
  - `[<Language> glossary]`-prefixed sections: "select sections that would help the agent
    compose its NEXT reply in {language_label} — vocabulary domains the reply is likely to
    enter, not just topics already mentioned. When the conversation seems to be entering a
    new topic area, prefer including the matching glossary section."
  The inclusion bias is deliberate: for scenario knowledge a false positive wastes cap
  budget, but for glossary a false negative sends the agent into a domain unarmed.
  Structured output (`RelevantKeys.titles`) and everything downstream stay unchanged.
- **Why not a separate glossary-retrieval call** with its own cleanly-phrased query: it
  doubles the side-car LLM calls on every non-English turn for marginal gain over the
  dual-framing prompt; the single call already has cache/timeout machinery. Revisit only
  if judge-measured glossary hit rate is poor and prompt tuning can't fix it.
- **Possible later signal, explicitly deferred:** the current simulation state's guidance
  is known at turn start and hints at the reply's direction — it could be added to the
  selector input. `next_instruction` can NOT be: branching detection runs in parallel with
  retrieval, and serializing them would add hot-path latency.
- Shared-cap caveat: glossary sections compete with scenario knowledge for the 8000-char
  total. Acceptable in v1 of Tier 1; revisit (separate cap or priority) only if `[RAG_TRUNC]`
  logs show real contention.

### 5.3 Precedence

Prompt states explicitly: scenario `languageCharacteristics` (per-scenario, per-language
free text) **overrides/extends** the global glossary on conflict.

---

## 6. Curation pipeline (ally-be)

Pattern borrowed from GCP `always-on-memory-agent` (ingest → consolidate → review);
its stack (ADK daemon, SQLite, read-all QueryAgent, Streamlit) is **not** adopted —
we have Postgres, the translation project's fire-and-forget job pattern, and the admin
dashboard as the review surface. The glossary is a *consolidated, evolving artifact with a
metabolism* — and every gram of that metabolism stays out of the per-turn hot path.

### 6.1 Seed (per language, once)

1. Admin triggers "Generate draft glossary" for a language.
2. A `glossary_generation` prompt row (registry, `useDashboardOverride=true`, provider
   `gemini`, editable in Prompt Management — mirror of `agent_template_translation`) is run
   through `PromptTranslationProviderService`-style plumbing (`LlmProviderFactory`).
   Inputs: language + `evalConfig` (script, `targetVariety`, `diglossia`), tone guidelines,
   code-mix preserve words, the three entry-type specs, per-section token budgets.
3. Output lands as `status='draft'` rows per `sectionCode`. Native-speaker review → publish.

### 6.2 Consolidate — weekly, per language, unattended

`GlossaryConsolidationSchedulerRegistrationService`. Mode from
`GLOSSARY_CONSOLIDATION_SCHEDULE` (`off` | `propose` | `auto`; prod = `propose`).
A language consolidates when **either** trigger fires:

- **interval** — the last batch is older than `GLOSSARY_CONSOLIDATE_INTERVAL_HOURS`
  (default **168**, i.e. weekly), or
- **volume** — unconsumed annotations reach `GLOSSARY_CONSOLIDATE_MIN_ANNOTATIONS`
  (default 25), an early fire for a language producing errors fast

Both are floored by `GLOSSARY_CONSOLIDATE_MIN_GAP_HOURS` (default **24**), checked *before*
the triggers. The original "every 30 minutes" cadence was wrong in both directions: too
frequent for a prompt-prefix artefact, and it re-fired on every tick for languages whose
annotations can never cluster, because a run that produced nothing wrote no batch and left
the clock frozen. An empty batch is now recorded — it is also the honest audit record that
distinguishes a quiet loop from a stalled one.

**The read** (`unconsumedAnnotationsQuery`), in this order, all in SQL:

1. real tenants only — `excludeTestTenants`; internal/demo/QA traffic was >50% of the
   Kannada style-annotation pool, and an unfiltered read learns style from our own testers
2. the **consumed-set excluded before the limit** — the stall that cost 8 days across every
   language came from applying `GLOSSARY_CONSOLIDATION_ANNOTATION_LIMIT` (200) to the most
   recent rows and dropping consumed ones afterwards
3. `occurredAt` within `GLOSSARY_CONSOLIDATION_RECENCY_DAYS` (**90**) — a rule enters every
   turn's prompt, so its evidence must describe the agent we ship now; an unbounded read
   reached back to 2026-04-06 across two different agent LLMs per language
4. `excludeForeignScripts` on `aiText` — 8 queued proposals were Tamil rules filed under
   `en-IN`, derived from foreign-script evidence

**The gates**, before the LLM sees anything (`construct-class.util.ts`):
construct-class typing → clustering by evidence similarity within (construct, category) →
`GLOSSARY_MIN_CLUSTER_SUPPORT` (2, with singletons allowed while a language has <20
unconsumed annotations so thin languages don't stall) → `fluency` only via
`GLOSSARY_SYSTEMATIC_MIN` (5).

**Duplicate suppression**, three layers, whole-language scope (`glossary-dedupe.util.ts`):
the consolidation prompt is shown the existing glossary and told not to restate it (the
only layer that can catch a paraphrase); exact identity, case/whitespace-insensitive; and
near-identity on **ordered token bigrams** at Jaccard ≥ 0.85 — bigrams rather than a token
bag, because a bag makes a rule and its reversal score 1.0 and silently suppresses the
reversal.

**Routing.** A proposal becomes a profile overlay when every supporting tenant maps to the
same variety profile, and global when support spans profiles or is unattached — **but only
when the language has at least two attached variety profiles.**

That gate exists because the single-profile signal has to carry information. With one
attached profile, "every supporting tenant maps to the same profile" is a tautology: it
reflects which tenants happen to send traffic, not evidence that the rule is
variety-specific. Measured 2026-09-03, Tamil was the only language with a profile and had
exactly one, so 65% of its published glossary had been routed into that single org's
overlay — including plainly universal Tamil grammar (animacy agreement, the dative case on
`காத்திரு`, colloquial conditional suffixes). Two consequences, both bad: a second Tamil
tenant would have inherited none of it, and the global glossary could never grow, because
every rule the language learned was routed away from it. en/hi/mr/kn were unaffected —
they have no variety profiles at all.

With two or more profiles the signal is real: the other populations existed and did not
produce the error. Below that threshold, everything routes global.

The 2,338 tokens already sitting in Tamil's overlays predate this gate. `grammar` was the
only one with no global counterpart, so a global copy was published on 2026-09-03 to close
the gap; the others (`core_style`, `pronouns_kinship`, `general_vocabulary`) each have a
global a second tenant would inherit.

**Statistics disposes.** Lexicon proposals are scored against the real learner corpus;
`verdict='contradicted'` (the population itself uses the avoid-term,
`GLOSSARY_LEXICAL_CONTRADICTION_MIN` = 5) is never auto-accepted.

### 6.3 Adjudicate — hourly, unattended (replaces "humans approve")

`GlossaryAdjudicationService`, mode from `GLOSSARY_ADJUDICATION_SCHEDULE`
(`off` | `preview` | `apply`; prod = `apply`). The original §6.3 assumed an admin who reads
Tamil, Kannada, Hindi and Marathi. No such person exists, so `propose` meant the queue grew
forever while `auto` published whatever the consolidator produced. Reviewing the first real
queue by hand on 2026-09-02 showed why neither is acceptable: of 51 proposals, 20 had to be
rejected, and the two largest categories are judgements a machine makes reliably.

What that review found, and what the pass therefore checks:

- **Actor behaviour, not language** — 9 English + 3 Hindi proposals were "do not break
  character", "avoid numbered lists", "let the counsellor lead". Real signal, wrong
  container: a language glossary is injected per language, and these belong in the agent
  prompt. Largest single category.
- **Wrong language entirely** — 8 Tamil rules under `en-IN`. Now prevented upstream by
  `excludeForeignScripts`, so this pass should never see them again.
- **Rule form is ANNOTATED, never vetoed** (`classifyRuleForm`). A first cut auto-rejected
  the buried-pair shape; a production dry run then rejected all six queued proposals, every
  one legitimate. A regex cannot tell an abstract opener from a substitution stated in prose.

Outcomes: accepts apply immediately (reversible via the batch record); rejects need two
consecutive votes (§4); **every** failure mode — unparseable output, provider error, skipped
proposal, Tier 0 cap breach — lands in `deferred`. Cap pressure is reported, not fought: a
proposal that would breach the cap is deferred with its reason after one re-tier attempt,
because the cap is authoritative and the answer is re-tiering or trimming, not squeezing.

### 6.4 Tiering — automated knapsack (replaces `importance`)

`computeTierAssignment` (`tier-assignment.util.ts`), triggered by
`POST /v1/language/:id/glossary/retier` and by the adjudicator's re-tier attempt. Sections
rank by score/token density and Tier 0 is the prefix that fits `TIER0_TOKEN_CAP` (2000,
`o200k_base`). Pins pre-consume budget and win unconditionally; incumbent always-sections
compete with a `(1 + TIER_HYSTERESIS)` multiplier so a challenger must beat them by more
than 0.15 to displace one, which stops tier flapping. The cap stays a hard invariant
regardless of incumbency.

⚠️ **Known limitation.** The score is `usageOf` (how often the section's terms appear in
live speech) + `TIER_ERROR_MASS_WEIGHT` × `errorMassOf` (severity of the annotations that
*created* the rule). Both look backward: neither asks whether the rule fixed anything.
Tier 0 priority is currently proportional to the severity of the disease, not the efficacy
of the cure — which is why nothing is ever evicted for being ineffective, and why three
good Tamil proposals sit deferred behind rules that have never been shown to work (§13).

### 6.5 Review surface (what remains for humans)

Admins can still accept/reject individual proposals, edit markdown, publish, archive,
pin a tier, and roll back a whole batch — the glossary manager at
`/manage-scenario-languages/:id/glossary`. Publishing bumps `version`. Running sessions keep
the glossary they started with (room metadata is per-session); new sessions pick up the new
version. The change is that **nothing waits on a human**: the schedulers decide, and the UI
is for correction and audit rather than for throughput.

---

## 7. Model routing check (precondition, not a phase)

Before attributing Tamil incoherence to context gaps: **verify prod Tamil sessions actually
resolve the Gemini config** in `languages.llmProviderConfig`
(seeded by migration `1768392581395-AddLlmAndSttProviderConfigToLanguages.ts`) rather than
falling through to the `gpt-4o-mini` default
(`configure_llm_client` precedence, `ally-ai-learn/app/core/agent/factory.py:303`).
No glossary compensates for a model that cannot form Tamil sentences. Cheap to check
(session logs / room metadata), potentially the biggest single lever for failure mode #2.

---

## 8. Admin UI (ally-web / ally-admin-dashboard)

> **Superseded in part.** The markdown pivot replaced the per-type entry editors with one
> markdown textarea per section plus a proposals inbox beneath it (admin feedback: the
> structured editor was too heavy). The *guiding decision* below inverted with it — a
> section is now authored as a document, not a dataset. Live surface:
> `/manage-scenario-languages/:id/glossary`. The API subsection is current.


**Guiding decision: the glossary is presented as a dataset, not a document.** No large
textarea paragraphs (the `KnowledgeSource.tsx` title+textarea pattern does not scale here).
Entries render as typed rows/cards; the prompt text is compiled, never hand-formatted.

- **`LanguageSidePanel.tsx` gets a summary card only** — section count,
  published/draft/proposed counts, Tier 0 token meter, "Manage glossary" link. The side
  panel is too narrow for a growing glossary; it stays a status surface.
- **Dedicated glossary manager** (drill-in view / full-page route — Prompt Management
  precedent), master-detail:
  - *Left rail*: sections with `injectionMode` badge (`always` vs `retrieved` visible at a
    glance — it's the token-budget boundary), status badge, per-section entry count +
    token cost; search box across all entries of the language.
  - *Detail pane*: per entry type —
    - `term_pair`: 3-column table (English / Say (colloquial) / Avoid (literary)), inline edit;
    - `rule`: card with the one-line rule + native-script example chips;
    - `pattern`: simple list of exemplar utterances.
  - Section header shows the `retrievalHint` (editable) for retrieved sections.
  - Consolidation proposals appear **inline** with a `proposed` badge on the entry row +
    a review affordance (accept / edit / reject), provenance on hover (linked annotation
    count). A section-level "Review N proposals" action collects them (Phase 4).
- **Token meter is the load-bearing element**: header bar shows Tier 0 total vs the hard
  cap; each `always` section shows its token cost. Count with a real tokenizer, not chars
  (Indic scripts inflate 2–4×). Publish is blocked past the cap (§5.1 / GL-6) — this is
  what makes glossary growth self-regulating: bounded where it hurts (always-injected),
  unbounded where it's harmless (retrieved sections, which just add searchable rows).
- **Actions:** "Generate draft glossary" (seed, §6.1), "Run consolidation" (§6.2),
  per-section publish/archive, "Add entry".
- Simulation editor unchanged — glossary is language-level; `languageCharacteristics`
  remains the per-scenario escape hatch.
- Scale expectations: Tier 0 cannot get large by design; Tier 1 at hundreds of entries is
  a searchable/paginated table (`NotionTable` patterns already exist in the dashboard).

### API (actual, `ally-be/src/language/controller/`)

Note the prefix is `/v1/language` — **singular**, not `/v1/languages` as originally sketched.

```
GET   /v1/language/:id/glossary                                   list sections
PUT   /v1/language/:id/glossary/:sectionCode                      create / edit (markdown)
POST  /v1/language/:id/glossary/:sectionCode/publish | /archive   lifecycle
POST  /v1/language/:id/glossary/generate                          seed job
POST  /v1/language/glossary/backfill                              seed all active non-English
POST  /v1/language/:id/glossary/consolidate                       consolidation run
POST  /v1/language/:id/glossary/retier                            recompute Tier 0 knapsack
POST  /v1/language/:id/glossary/:sectionCode/proposals/:entryId/accept | /reject
POST  /v1/language/:id/glossary/proposals/adjudicate              LLM adjudication (§6.3)
GET   /v1/language/:id/glossary/consolidation-batches             audit trail
POST  /v1/language/:id/glossary/consolidation-batches/:batchId/rollback
GET   /v1/language/:id/glossary/adherence                         deterministic scan (§9)
POST  /v1/language/:id/glossary/adherence/backfill
GET   /v1/language/glossary/adherence/overview
GET   /v1/language/:id/variety-profiles                           Phase 6
POST  /v1/language/:id/variety-profiles/infer
GET   /analytics/glossary-effect                                  impact, segmented (§9)
```

---

## 9. Evaluation & rollout

**Rollout** is per language, per tier, per section, all publish-driven and next-session
effective. Live in five languages (en, ta, kn, hi, mr) — English from 2026-08-20, later
than the rest. Rollback = unpublish or archive; batch rollback for a whole consolidation run.

**Two measurement signals, deliberately different in kind:**

1. **Deterministic adherence** (`glossary_adherence_reports`, §Phase 9). Scans agent
   utterances for published `(avoid: …)` terms. Judge-independent, so it is the only signal
   that survives a judge error. Read
   `violationsPer100AgentMessages`, not `avgViolationsPerSession` — the latter is dominated
   by session length. **This measures a floor, not quality**: an agent can obey every avoid-
   term and still sound stilted, and the scan is structurally blind to grammar rules, which
   carry no avoid-terms at all.
2. **Judge deltas**, existing protocol — per-category error rates before/after publish,
   pinned `judge_version`, deltas + spot-checks, no hand-labeled sets and no κ gates.

**Segmentation is not optional.** `GET /analytics/glossary-effect` has grain
`(language, period, agentModel)` for a reason: gpt-4.1-mini is ~4.5× worse than
gpt-4o-mini on language quality, so an unsegmented before/after reads a traffic-mix shift
as a glossary effect. Per-language go-live is derived in SQL from each language's first
`published` section — applying one date across languages produced a fake English
regression that nearly got the English glossary disabled.

**Measured as of 2026-09-03**, stated at the confidence the data supports:

| Claim | Figure | Basis |
|---|---|---|
| Avoid-term violations | **−27%** | deterministic scan, judge-independent |
| Judge naturalness, Tamil | **−8%** over 869 turns | the only language with defensible real-org volume |
| Every other language | **not established** | real-customer traffic ≈ 0 since early August |

Larger figures quoted earlier in the project did not survive segmentation and should not be
reused. A v2v glossary-on/off A/B remains the cleanest design and is blocked on expired
Google ADC.

**Latency watch:** `knowledgeRetrievalMs`
(`scenario-session-turn-metrics.entity.ts:71`) and main-LLM turn latency before/after
Tier 0 — confirm the ~1–2k-token prefill is absorbed by prompt caching and does not move
p95.

---

## 10. Observability

Worker/backend STDOUT has no downstream consumers — don't build on logs for anything that
must be queried later. State that matters lives in tables:

- `glossary_consolidation_batches` — per-run proposals / duplicates skipped / engineering
  findings; **empty batches included**, which is how a quiet loop is distinguished from a
  stalled one
- `glossary_adherence_reports` — per-session violations, with the section `version` scanned
- `/analytics/glossary-effect` — impact at `(language, period, agentModel)` grain
- `entries[].adjudication` — reject votes and last reason, so a wrong verdict is
  diagnosable without a re-run
- Tier 0 token size per language, exposed on the list API and metered in the UI

Log lines that are still the fastest diagnostic, accepting the caveat above:
`[GLOSSARY_CONSOLIDATE]` (per-language skip reasons and counts), `[GLOSSARY]` tier-0
selection, `PROMPT_SOURCE` (whether a dashboard override or the file body is live — a
file-backed prompt silently opts OUT of dispatch), and `[ROOM_METADATA_SIZE]`
(warn ≥ 48 KiB).

---

## 11. Edge-case appendix

1. **Tier 0 over budget** — authoring-time hard warn; publish blocked past a hard cap.
   Runtime never truncates silently.
2. **Glossary/template placeholder mismatch** — `SafeFormatter` leaves missing keys
   harmless; templates without `{language_glossary}` simply don't render it (old prompt
   versions keep working).
3. **Translated-template interaction** — `{language_glossary}` travels inside translated
   bodies like every other placeholder; each language's session gets its own glossary, no
   cross-language leakage.
4. **Tier 1 cap contention** — shared 8000-char cap with scenario knowledge; monitor
   `[RAG_TRUNC]`, split caps only if real.
5. **Conflict with scenario `languageCharacteristics`** — precedence stated in prompt;
   scenario wins.
6. **Consolidation proposes junk** — ~~never auto-publish~~ **the adjudicator decides it**
   (§6.3), with statistical gates upstream (support floor, systematicity, corpus
   contradiction) and provenance on every proposal. Human review remains available but
   nothing waits on it.
7. **Session mid-flight during publish** — session keeps its start-time glossary; new
   sessions get the new version (same rule as prompt translations).
8. **Legacy constants drift** — once a language's glossary is published, its code-mix/tone
   constants are served *from* the glossary to the translation pipelines too (single source
   of truth); until then constants remain authoritative.
9. **Retrieval selector language** — title selection runs over titles + recent conversation
   (target language); prefixed English titles + `retrievalHint` keep selection robust. If
   hit rate is poor, bilingual titles/hints are the first fix, a dedicated glossary
   retrieval call the second.
10. ~~**`languages.evalConfig` entity drift**~~ — **fixed in Phase 1**; the column is on
    `languages.entity.ts:63`.
11. ~~**Room-metadata size budget**~~ — **resolved in Phase 2 by telemetry, not by a
    precondition study.** `[ROOM_METADATA_SIZE]` logs every payload and warns at 48 KiB
    against LiveKit's 64 KiB cap (`scenario-shared.service.ts:880`); local scenarios max
    ~2 KB. *But see #14* — oversized metadata later became a real production failure.
12. **A reject is permanent.** Rejecting keeps the row `rejected`, so the annotations stay
    consumed and nothing re-derives the rule. Accepts are reversible through the batch
    record; rejects are not. Mitigated by two-vote rejects and temperature 0 (§4), not
    eliminated.
13. **A near-duplicate of a published rule is dropped without consuming its annotations**,
    so it is re-derived every cycle forever. Harmless when the published rule works;
    a permanent deadlock when it doesn't (§13.3).
14. **Oversized dispatch metadata broke agent join** (2026-07-21/22, coinciding with the
    1.47.x translations/glossary work): 160–213 KB room+dispatch metadata over the
    ~148 ms Mumbai↔Hetzner link blew LiveKit's 3 s availability timeout, with no retry.
    Room metadata size is not a theoretical budget — it is a live failure mode, and the
    glossary is one of the payloads that grows it.

---

## 12. Phasing (overview)

> **All six phases below are complete** (Phases 1–5 by 2026-07-22, Phase 4 + backfill same
> day). Phases 6–11 in the Status block postdate this list. Phase 0's finding — prod Tamil
> runs on `openai/gpt-4o-mini`, not the seeded Gemini config — was accepted as deliberate;
> that is the eval baseline, and a model switch would be its own re-baseline event.

1. **Phase 0 — Model routing check (§7).** No code. Confirm prod per-language LLM routing;
   record findings. Possibly the biggest lever on failure mode #2.
2. **Phase 1 — Foundation (ally-be).** Table + entity/repo + CRUD API + seed job
   (`glossary_generation` prompt row) + entity-drift fix. No runtime effect.
3. **Phase 2 — Tier 0 runtime.** Room-metadata delivery (ally-be) + `PromptData` field +
   `{language_glossary}` placeholder in main/branching templates (ally-ai-learn).
   Behind per-language flag.
4. **Phase 3 — Admin UI (ally-web).** Glossary tab on Language side panel, token meter,
   seed/publish controls. Tamil style card authored+reviewed; publish; judge-delta eval (§9).
5. **Phase 4 — Consolidation loop.** Annotation ingest → cheap-model consolidate →
   draft proposals with provenance; "Run consolidation" admin action.
6. **Phase 5 — Tier 1 retrieved sections.** Metadata merge + `build_knowledge_map` prefix
   merge + retrieval-prompt line; driven by which vocabulary domains the judge shows failing.

Phases 1–3 are the shortest path to impact (Tamil Tier 0, measured). 4–6 layer on without
rework.

---

## 12a. Phase 1 tickets (ally-be)

**GL-1 — Migration: `language_glossary_sections`.** Per §4: columns, enums
(`injectionMode`, `status`), unique `(languageId, sectionCode, organizationId)`, index
`(languageId, status, injectionMode)`, FK → `languages`. Also add the missing `evalConfig`
column to `languages.entity.ts` (drift fix, no migration needed — column exists).
Done-when: up/down runs on local `ally_local`.

**GL-2 — Entity + repository.** `LanguageGlossarySection` TypeORM entity; repo with
`findPublishedByLanguage(languageId, injectionMode?)`, `upsertDraft`, `publish`, `archive`.
Done-when: unit test round-trips rows and filters by mode/status.

**GL-3 — CRUD + lifecycle API.** Endpoints per §8 sketch (list, draft edit,
publish/archive), guarded by the language-management permission. Done-when: e2e test covers
draft→publish→archive and that runtime query (`GL-2` `findPublishedByLanguage`) only sees
published.

**GL-4 — Seed `glossary_generation` prompt row.** Migration inserting the registry prompt
(`useDashboardOverride=true`, `provider='gemini'`) + first version body: entry-type specs,
per-section budgets, native-script examples, "avoid literary register" guidance, inputs from
`evalConfig`/tone constants. Must also produce a one-line `retrievalHint` per
`retrieved`-mode section (trigger conditions for the selector, §5.2).
Done-when: row editable via existing prompt endpoints.

**GL-5 — Seed job.** `generateDraftGlossary(languageId)`: run GL-4's prompt through the
`LlmProviderFactory` path, parse into per-section drafts, upsert with
`provenance={source:'seed'}`. Bounded retries; per-section failure recorded not thrown
(translation-job pattern). Done-when: manual run against real Gemini produces reviewable
Tamil drafts.

**GL-6 — Glossary compiler + token guard.** `compileSection(section)`: deterministic
rendering per entry type (term-pair table lines, rule + examples, patterns) over
`published` entries only; `resolveTier0Glossary(languageId)`: compile + concatenate
published `always` sections in fixed order; token-count util (real tokenizer); expose
per-section and Tier 0 totals via the list API; block publish when the `always` set would
exceed the hard cap. Done-when: table-driven tests cover per-type rendering,
proposed-entry exclusion, order, empty-language, cap enforcement.

Phase 1 stops before any runtime or UI surface — the glossary can be generated, stored, and
reviewed via API with zero production impact.

---

## 13. Open items

**Resolved since the original list:** entry language (#10, English scaffolding); tenant
scope (#11, `organizationId` nullable + variety-profile overlays as the real axis); Tier 0
cap (2,000 confirmed); tokenizer (`o200k_base`, as suggested); consolidation cadence
(weekly scheduler, 24h floor — not button-only); Phase 0 (routing is gpt-4o-mini, accepted
as deliberate); judge baseline (captured; but see the segmentation warning in §9).

**Open, in priority order:**

1. **Tier 0 cap starvation — needs a decision, not a retry.** Three good Tamil proposals
   are deferred at 2,065 / 2,000 tokens. Raising `TIER0_TOKEN_CAP` costs tokens on every
   turn of every Tamil session, permanently; the alternative lever is the ~1,263 tokens of
   *global* sections, since the overlay budget is what remains after those. Blocked on a
   judgement call about which.
2. **Nothing measures whether a published rule works** (§6.4). Both components of the
   tiering score look backward, so an ineffective rule keeps its Tier 0 slot indefinitely
   and no eviction path exists. This is the root cause of (1): the cap is full of rules
   that have never been shown to do anything. Design under discussion in
   `ally-be/docs/language-glossary-v2-design.md`.
3. **An ineffective rule cannot be improved.** A proposal matching published content is
   dropped by dedupe (`skippedDuplicates++`) *and its annotations are never consumed*, so it
   is re-derived and re-dropped every cycle, forever. Same doc as (2).
4. **The glossary consolidation backlog is 3 months old.** Unlocked by the v1.82.11 fix but
   not yet drained; `SCHEDULE` is deliberately `propose` rather than `auto` so the drain is
   adjudicated rather than published wholesale.
5. **Adjudicator stability.** Temperature is pinned to 0 and rejects need two consecutive
   votes, but the underlying variance was found by reading verdicts, not by the 253 passing
   tests. Worth watching a few unattended cycles before trusting it further.
6. **Constants absorption (§11.8):** `CODE_MIXING_PRESERVE_WORDS` /
   `LANGUAGE_TONE_GUIDELINES` in `translation.constants.ts` are still a second source of
   truth for tone and code-mixing. Decide when the translation pipelines read these from
   the glossary instead.
7. ~~**This document has no CI guard.**~~ **Resolved 2026-09-03.** It used to sit at the
   *workspace* root — outside `ally-be`, outside any git repository at all, so it was
   both unversioned and invisible to `.docs-map.yml`. That is why §4/§6/§8/§9 drifted for
   six weeks without anything failing. It now lives at `ally-be/docs/`, tracked, with a
   `language-glossary-architecture` rule watching `src/language/**`: a change under that
   path fails CI unless this doc is touched too. The filename was deliberately NOT
   kebab-cased — 14 code comments cite it by bare filename and four of those are in
   merged migrations, which must never be edited.

---

*Last verified against code: 2026-09-03 (ally-be v1.82.22, task def rev 373).*

*Rewritten from source in this pass: the Status block, §2 decisions 5/8/9/10/11, §4, §5.1/5.2,
§6 (all of it), §8 API, §9, §10, §11 items 6/10/11 plus new 12–14, §12 banner, §13.
Re-read and left standing: §1, §1a, §3, §5.3, §7, §11 items 1–5/7–9, §12 phase list.*
