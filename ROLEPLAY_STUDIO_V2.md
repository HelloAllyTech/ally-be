# Roleplay Studio v2

An AI-copilot-driven studio for designing voice roleplays. A trainer answers a few
questions; the system compiles a **Scenario Spec** and runs it as a live, voice-based
counseling simulation where an AI **client** is continuously steered to create the right
learning moments for the trainee.

Studio v2 ships **alongside** the existing simulation studio (v1) — v1 and its published
simulations are untouched. This document is a reference snapshot; the **code and prompt files
are the source of truth** (paths are given throughout). Keep this updated when the spec schema
or prompts change.

## Repos

| Repo | Role in Studio v2 |
|------|-------------------|
| `ally-be` (this repo) | Owns the **Scenario Spec** + versioning, the **Copilot** (spec authoring), session dispatch, the **Rehearsal** lifecycle, and all Director telemetry persistence. Module: `src/roleplay-studio/`. |
| `ally-ai-learn` | The **runtime**: a separate LiveKit worker (`worker_v2`) that plays a spec as an **Actor + Director** voice session, plus the **rehearsal harness** (simulated trainees + QA judge). Package: `app/roleplay_v2/`. |
| `ally-web` | The **studio UI** (`apps/ally-admin-dashboard`): copilot chat, live spec panel, state-machine editor, rehearsal review, publish + live preview. |

---

## Mental model

The unit of work is the **Scenario Spec** — one versioned JSON document that fully describes a
roleplay. Three LLM roles revolve around it:

- **Copilot** (`ally-be`) *builds* the spec by interviewing the trainer.
- **Actor + Director** (`ally-ai-learn`) *run* the spec as a live voice roleplay.
- **Simulated Trainees + Judge** (`ally-ai-learn`) *test* the spec before publish.

The spec is the single source of truth. Every prompt either writes it, reads it, or is compiled
from it. Three concerns are modeled **separately** so they can be controlled independently:

1. **Persona fidelity** (stable) — who the client is: identity, backstory, speech style.
2. **Pedagogical control** (dynamic) — objectives, difficulty, disclosure pacing, resistance.
3. **Interaction realism** (runtime) — latency, fillers, prosody/emotion.

---

## The Scenario Spec (what defines the actor)

Stored as `roleplay_spec_versions.spec` (jsonb); the working draft lives on `roleplay_specs.draftSpec`.
Validated by `src/roleplay-studio/service/spec-validator.service.ts`. Key fields:

| Field | What it drives |
|-------|----------------|
| `persona {identityCore, scenarioContext, chunks[]}` | Who the client is + retrievable background memory |
| `stateMachine {initialStateId, states[]}` | 3–6 **emotional states**; each has a `stateCard`, `prosodyHints`, and `transitions` guarded by rubric behavior ids (`whenBehaviorsAny/All`, `minTurnsInState`, `minCumulativeScore`) |
| `disclosureLedger {secrets[]}` | Tiered secrets, each with `unlockConditions`, `minStateIds`, and an in-voice `lockedDeflection` |
| `rubric {behaviors[]}` | Observable trainee behaviors (`helpful`/`unhelpful`, `weight`, `examples`) — the scoring + transition currency |
| `engineeredEvents[]` | Time/behavior/score-triggered pressure beats (`direction`, `once`) |
| `voice {languageVoices}`, `language` | TTS voice per language |
| `openingStatement`, `difficulty` | Client's literal first line; difficulty envelope |
| `actorModel`, `directorModel` | Per-role model overrides (defaults otherwise) |
| `ui` | Client-owned (e.g. graph node layout) — opaque passthrough |

At runtime the compiler maps the spec into two layered prompts (see **Run**).

---

## Flow 1 — BUILD (Copilot, in `ally-be`)

Trainer ⇄ copilot chat, streamed over SSE
(`POST /v1/roleplay-studio/copilot/sessions/:id/messages/stream`).

1. **Interview — 4 questions, one at a time** (via the `ask_trainer` tool): skill trained →
   learner profile → client sketch → success criteria.
2. **Inference** — the copilot translates human answers into machinery: resistance profile,
   the state machine, tiered disclosure ledger, rubric, engineered beats, opening line, prosody,
   difficulty.
3. **Persist** — after every answer it calls `update_spec` (small RFC-6902 patches); each patch
   appends an immutable `roleplay_spec_versions` snapshot. `compile_spec` validates;
   `suggest_test_cases` + `propose_rehearsal` set up verification.

Orchestrator: `src/roleplay-studio/service/copilot-orchestrator.service.ts` (Anthropic tool loop).
Tools: `copilot-tools.service.ts` (`update_spec`, `ask_trainer`, `suggest_test_cases`,
`pick_voice`, `get_competencies`, `compile_spec`, `propose_rehearsal`).

**Prompts** (`src/prompts/roleplay_copilot/`):

| Prompt | Role |
|--------|------|
| `interviewer_system.txt` | Copilot system prompt: the 4-question protocol, tool policy (one question/turn, patch after every answer), and the design quality bar |
| `inference_pass.txt` | Rules for inferring the mechanics (resistance, disclosure tiers, state-machine shape, events, opening line, prosody, difficulty) from the four answers |
| `spec_compiler.txt` | Backs `compile_spec`: validate/normalize the draft and report fixable errors |
| `rehearsal_critique.txt` | Turns rehearsal judge findings into concrete proposed spec patches |

---

## Flow 2 — TEST (Rehearsal harness, in `ally-ai-learn`)

Before publish, the spec is exercised by three scripted trainees running through the **real
Actor + Director loop** (text-only), then scored by a QA judge. `ally-be` launches it
(`POST /v1/roleplay-studio/specs/:specId/versions/:versionId/rehearsals` →
`ai-learn POST /api/v1/roleplay-rehearsal/run`) and receives results via webhook.

**Prompts** (`app/prompts/trainee/`, `app/prompts/judge/`):

| Prompt | Role |
|--------|------|
| `trainee/base.txt` | Shared simulated-trainee (counselor) framing |
| `trainee/skilled.txt` | Textbook competency behaviors — should progress states legitimately |
| `trainee/poor.txt` | Closed questions, advice-giving, judgment — must **not** be handed progress |
| `trainee/adversarial.txt` | Demands secrets, breaks character, prompt injection — stress-tests discipline |
| `trainee/stagnation_steering.txt` | Anti-repetition nudge when the simulated conversation loops |
| `judge/system.txt` | QA judge: scores **persona consistency, disclosure discipline, difficulty calibration, rubric coverage** (0–100), flags secret leaks, writes a spec-level critique |

The judge's numeric scores are **cross-checked in code** with deterministic secret-leak
detection (string containment before unlock) and rubric coverage; the deterministic result wins
on conflict. Findings feed `rehearsal_critique.txt` back in the copilot as accept/reject patches.

The Actor and Director prompts (below) are used **verbatim** in rehearsal — that's the point:
the harness tests the real runtime, not a stand-in.

### Evidence-rich critique + persisted proposals

The post-rehearsal critique is fed more than the judge summary: `CritiqueEvidenceService`
condenses the stored transcripts + director traces (failed test cases in full, leak-window
exchanges, state-path timelines, uncovered rubric behaviors) under a char budget, and the
prompt also receives the spec's **proposal history** so the model never re-proposes a patch
that was rejected or failed verification. Every proposal is normalized to flat RFC-6902 `ops`,
pre-validated against the critiqued version (invalid → `SKIPPED_INVALID`), persisted to
`roleplay_critique_proposals` with a predicted `expectedEffect` (dimensions/test cases it
should move), and lifecycle-tracked: `PROPOSED → APPLIED/REJECTED → VERIFIED /
FAILED_VERIFICATION` once a later rehearsal confirms or contradicts the prediction.

### Flow 2b — AUTO-IMPROVE (autonomous iteration loop, in `ally-be`)

`ImprovementOrchestratorService` closes the loop end-to-end: **rehearse → critique → apply the
proposals to a scratch version lineage (`roleplay_spec_versions.source = auto_improve` — the
trainer's draft is never touched mid-run) → re-rehearse**, advancing on rehearsal webhooks (a
Redis TTL watchdog finishes a stalled run with its best-so-far). Stop conditions: targets met
(deterministic-first — all selected agent test cases PASSED and no PASSED→FAILED flip vs the
baseline round, then judged minimums with a ±5 noise band), the critic produces no new
proposals (an ops-hash guard also hard-skips retried patches), or `maxRounds` (default 3).
Intermediate rounds can run a **cheap targeted scope** (only the failing profiles/test cases);
a cheap round that meets targets is re-verified at full scope before the loop stops. The
trainer then reviews the score trajectory + cumulative diff (`GET
/v1/roleplay-studio/improvement-runs/:id/diff`) and **accepts** (best version's spec is copied
into the draft, `source = auto_improve_accepted`, guarded by an optimistic-concurrency token)
or **discards**. Tables: `roleplay_improvement_runs`, `roleplay_improvement_rounds`; UI: the
studio's *Improve* step (socket namespace `/roleplay-studio/improvements`).

The copilot also sees rehearsal evidence directly: `get_rehearsal_findings` (scores + deltas
vs the previous run + failing test cases + condensed evidence + proposal history) and
`get_improvement_run_status` tools, plus a one-line "latest rehearsal" note in its system
prompt; `suggest_test_cases` now emits a structured `test_case_suggestions` SSE frame the
studio renders as accept-to-persist cards.

---

## Flow 3 — RUN (Actor + Director, in `ally-ai-learn`)

`ally-be` dispatches a LiveKit room to the v2 agent (`LIVEKIT_ROLEPLAY_AGENT_NAME`, default
`AgentV2`) with the compiled spec in room metadata. `worker_v2` parses it and builds STT/TTS/LLM.
Two agents split by latency budget:

### Actor — hot path, fast model
The system prompt is compiled in two layers for KV-cache stability:

| Prompt (`app/prompts/actor/`) | When | Contents |
|-------------------------------|------|----------|
| `static_prefix.txt` | Compiled **once per session**, byte-stable | L1 *identity core* + L2 *scenario context* + language/speaking-style + "you are the client, never an assistant" guardrails |
| `turn_card.txt` | Rendered **every turn** (trailing system message) | L3 *current state card only* · L4 *disclosure ledger* (locked secrets are **omitted entirely** — the actor only ever sees the deflection) · L5 *background memory chunks* · L6 *one-line stage direction* |

### Director — async sidecar, strong model, runs during TTS playback
Reads each exchange and returns one JSON verdict (re-validated in code), never blocking the voice
path. On timeout the Actor proceeds "stale by one" and the late verdict still commits (monotonic
turn-index guard).

| Prompt (`app/prompts/director/`) | Role |
|----------------------------------|------|
| `system.txt` | The Director's 8 duties: judge trainee behaviors vs rubric (with verbatim evidence), evaluate guards, propose next state, unlock disclosures, fire engineered events, write the next stage direction, nominate retrieval topics, optional coaching feedback |
| `turn_user.txt` | Per-turn message: rolling conversation window + serialized runtime state → "return the verdict JSON" |

### The loop in one breath
STT → **Actor** replies from `[static_prefix] + history + [turn_card]` → TTS speaks it. *While
that audio plays*, the **Director** scores the exchange and the runtime (code-validated) advances
state, unlocks/holds secrets, fires events, and writes the next turn card's stage direction — so
difficulty and disclosures track what the trainee actually does. Verdicts are streamed to the
studio's live observer panel (LiveKit data channel, topic `director`) and persisted via SQS
(`director_state_transition`, `director_rubric_score`, `director_disclosure_unlock`,
`director_stage_direction`, `roleplay_session_summary`).

---

## Prompt catalog (all 14)

| Prompt | Repo · path | Phase | Role |
|--------|-------------|-------|------|
| `interviewer_system` | ally-be · `prompts/roleplay_copilot/` | Build | Copilot system: 4-Q interview + build rules |
| `inference_pass` | ally-be · `prompts/roleplay_copilot/` | Build | Infer mechanics from the 4 answers |
| `spec_compiler` | ally-be · `prompts/roleplay_copilot/` | Build | Validate/normalize the draft spec |
| `rehearsal_critique` | ally-be · `prompts/roleplay_copilot/` | Test→Build | Judge findings → proposed spec patches |
| `actor/static_prefix` | ally-ai-learn · `prompts/actor/` | Run + Test | Stable identity/context/style (compiled once) |
| `actor/turn_card` | ally-ai-learn · `prompts/actor/` | Run + Test | Per-turn state + ledger + memory + direction |
| `director/system` | ally-ai-learn · `prompts/director/` | Run + Test | Referee: score, transition, unlock, direct |
| `director/turn_user` | ally-ai-learn · `prompts/director/` | Run + Test | Per-turn window + state → verdict request |
| `trainee/base` | ally-ai-learn · `prompts/trainee/` | Test | Simulated-trainee framing |
| `trainee/skilled` | ally-ai-learn · `prompts/trainee/` | Test | Competent counselor profile |
| `trainee/poor` | ally-ai-learn · `prompts/trainee/` | Test | Weak counselor profile |
| `trainee/adversarial` | ally-ai-learn · `prompts/trainee/` | Test | Hostile / injection profile |
| `trainee/stagnation_steering` | ally-ai-learn · `prompts/trainee/` | Test | Anti-loop nudge |
| `judge/system` | ally-ai-learn · `prompts/judge/` | Test | QA-scores the runtime vs the spec |

All prompts are managed templates: `ally-be` syncs `src/prompts/**` into the `prompts` registry on
boot (dashboard-overridable); `ally-ai-learn` resolves `app/prompts/**` with an optional
dashboard override.

---

## Coexistence with v1

Publishing a spec materializes a **thin `scenarios` row** (`engine = 'ROLEPLAY_V2'`,
`roleplaySpecId` set) so learner lists, tenant sharing, credits, and sessions ride the existing
mechanisms. `startScenarioSession` branches on `engine` to dispatch the v2 runtime; the v1 studio
rejects editing v2 rows (422). See `DATA_SCHEMA.md` §3.9 for the tables.

---

## Key code paths

- Spec + versioning + publish: `src/roleplay-studio/service/roleplay-spec.service.ts`, `spec-validator.service.ts`
- Copilot: `service/copilot-orchestrator.service.ts`, `service/copilot-tools.service.ts`
- Session dispatch + Director telemetry: `service/roleplay-session.service.ts`, `processor/*`
- Rehearsal: `service/rehearsal.service.ts`, `controller/rehearsal-webhook.controller.ts`
- Runtime (ally-ai-learn): `app/worker_v2.py`, `app/roleplay_v2/{actor,director,session,rehearsal}/`
