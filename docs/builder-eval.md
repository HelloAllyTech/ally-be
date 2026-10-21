# Builder replay eval

Builder's interview is judged by replaying recorded interviews through the real interview
loop and scoring what happens. Builder prompt changes go live only through this eval.

Code: `src/builder/eval/` (sandbox, runner, suites, controller) and three tables,
`builder_eval_fixtures`, `builder_eval_suites` and `builder_eval_runs` (see `DATA_SCHEMA.md`).

## Fixtures

A fixture is a recorded interview: the admin's opening message, everything they said after
it, and a **checklist a person writes once** saying what a correct PRD contains (`must`) and
must not contain (`must_not`). An interview fixture without a checklist still runs, and its
gates still count, but the judge has nothing to score.

Fixtures carry what a production admin typed, and this repo is public, so **they live in the
database and never in a file here.** Ways to make one:

- `POST /v1/builder/eval/fixtures/from-session/:sessionId`: a session in this environment.
- `POST /v1/builder/eval/fixtures/from-export` with `{ name, session, checklist }`, where
  `session` is the body of `GET /v1/builder/sessions/:id` from another environment
  (production through the workspace's read-only prod script, for example). This is how a production
  interview becomes a fixture on a laptop.
- `GET /v1/builder/eval/fixtures/export` and `POST /v1/builder/eval/fixtures/import` copy
  fixtures between environments. Import matches fixtures by name.
- `POST /v1/builder/eval/fixtures` with `kind: "prd_review"`: a single PRD for the critic,
  either a seeded defect (`expect: { blocking: true, via: "<review category or readiness
  row>" }`) or a clean control (`expect: { blocking: false }`).

`pins` (repo to commit) pins file reads in the replay to the commits the session ran against.
Code search can't be pinned: GitHub only indexes the default branch.

## What a run does

**Interview fixtures.** The fixture plays through `BuilderInterviewOrchestratorService` in a
sandbox (`BuilderEvalSandboxFactory`):

- The real orchestrator, tools, readiness and cold reviewer run against in-memory stores, so
  a replay writes no builder row.
- The research tools are real. They only read.
- A simulated admin answers each turn from the fixture's script and checklist, and corrects
  Builder wherever the checklist contradicts it.
- The replay stops when the PRD reads ready, when the admin has nothing left to say, or after
  14 turns.

**PRD-review fixtures.** The PRD, evidence and transcript are loaded into the sandbox and
readiness is settled, which runs the cold reviewer. The run passes if the outcome matches
`expect`.

### Scoring

The **gates** are deterministic counts of failures the interview has really shipped:

| Gate | Counts |
|---|---|
| `unseenFailures` | tool calls that failed in the same batch as the reply that ended the turn (`ask_admin` or `finish_turn`) |
| `askedBeforeReading` | batches that ended the turn while research results were unread |
| `unrepairedEditFailures` | PRD edits (`update_prd` or an edit-by-id tool) that failed with no successful edit after them in the turn |
| `falseUpdateClaims` | turns whose reply claims a PRD change while no edit succeeded |

Only a reply that reached the admin counts. With validated turns on, a reply batched with an
unread lookup or a failed call is sent back to the model instead of shown (its result says
`delivered: false`), so that batch hid nothing from anyone. `questions` counts questions
delivered, not `ask_admin` calls made.
| `consistent` | the final PRD's test-plan, requirement-home and mobile-twin readiness rows |
| `evidenceCited` | What already exists rests on files the replay read |

A run **passes** when every gate is clean, the simulated admin never corrected Builder, the
PRD reached ready, and every checklist item is met.

A model **judge** scores the checklist. It only scores; it never decides a gate on its own.

The default is three runs per fixture, because the model is not deterministic.

## Suites and the prompt gate

`POST /v1/builder/eval/suites` runs the active fixtures (or `fixtureIds`) on the live
settings, in the background, two runs at a time. A suite survives a deploy: it heartbeats every minute, and one
silent for 10 minutes is resumed by another process. Finished runs are kept, and a run cut off
mid-way starts again. After three resumes it is marked errored. `POST /v1/builder/eval/suites/:id/cancel` stops a running suite: unstarted runs are cancelled, a run already in flight finishes and keeps its result, and a cancelled prompt-gate suite never publishes. Every suite records which
interview loop it ran in `overrides.validatedTurns` — the live `builder_settings.validatedTurns`
unless the request passes `validatedTurns` to compare the two loops. Suites from before the
switch existed have no value and replay the legacy loop even when resumed after a deploy, so a
suite never changes loops halfway. Each run's `metrics.loop` says which loop it replayed. The
interview protocol is stamped the same way, in `overrides.situationBrief` (the live
`builder_settings.situationBrief` unless the request passes `situationBrief`; absent means off),
and a prompt-gate baseline must match it too. Under it the simulated admin answers the situation
brief line by line — confirming what the ground truth agrees with, correcting what it
contradicts — and each run records `metrics.protocol`, `briefDelivered`,
`briefBeforeFirstQuestion` (what exists was named before anything was asked), `briefLines` and
`briefCorrections`; a reply that corrects the brief also counts in `corrections`. Read
the results with
`GET /v1/builder/eval/suites/:id`. Each run carries its gates, metrics, judge, and a
turn-by-turn transcript.

`POST /v1/builder/eval/prompt-candidates` proposes a change to a gated prompt
(`builder_interviewer_system`, `builder_platform_rules`). The change can be new text, model
settings, or both. The flow:

1. The fixtures are replayed with the candidate. The candidate is applied inside the sandbox
   only, so nothing live reads it.
2. The result is compared with a baseline on the live settings. A baseline is reused if it
   covers the same fixtures, is under 7 days old, overrode no prompt or model, and ran the
   same interview loop; otherwise one is run alongside on that loop. A baseline from the other
   loop would credit or blame the prompt for what the loop did.
3. The candidate passes when nothing got measurably worse:
   - gate violations and corrections did not rise;
   - the checklist score did not fall more than 0.05;
   - the critic missed no more seeded defects;
   - every run finished.

   The comparison is relative on purpose. Today's interviewer fails these fixtures, so an
   absolute bar would refuse even the edits that improve it.
4. A passing candidate is published through the prompts service, as the person who proposed
   it. A failing one publishes nothing. The verdict and its reasons are on the suite.

The prompt editor's own save and revert refuse behaviour changes to these prompts (409).

## Corrections become eval cases

`BuilderCorrectionService` runs daily over the last three days of admin replies. You can also
start it with `POST /v1/builder/corrections/scan`.

It classifies each free-text reply that follows a Builder message: is it a correction, and if so
which kind (missing capability, stale doc, platform scope, over-asking). Card picks and
acknowledgements are skipped without a model call.

Each correction is routed four ways:

- **A lesson candidate.** The curator folds it into the lessons every interview reads.
- **A draft reuse line.** A person adds it to `builder-capabilities.constants.ts`.
- **A draft doc fix.** Never published automatically: the repos and wiki are public, and the text
  came from production.
- **A checklist line on an `auto:` fixture** cut from the session. The fixture starts inactive. A
  person reads the line, adds what else a correct PRD contains, and switches it on. A fixture a
  person already curated for that session is never changed.

`GET /v1/builder/corrections` lists them, with corrections per session. That count is the fix
plan's north star.

## Cost

A run is a full interview plus one simulated-admin call per turn and a judge call. A suite of
eleven fixtures at three runs each is about thirty interviews. A prompt gate with no recent
baseline costs twice that. Eval spend is recorded as `builder_eval` in `llm_usage`, and
`metadata.evalOf` says which task each call replayed. Real interview cost charts never
include it. At most two suites run at once.
