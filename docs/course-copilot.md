# Course Copilot

An admin agent that interviews a trainer about a course, proposes a blueprint, waits for approval,
generates every component in the background into a DRAFT Track 2.0 course, and then keeps editing
that course on request. Release 1 is platform-tier only: the `course_copilot` feature toggle plus
`view:admin:course-copilot` / `edit:admin:course-copilot`. The admin page lives at
`/course-copilot` in ally-web.

Data model: [`DATA_SCHEMA.md` §3.19](../DATA_SCHEMA.md). Model calls: the `COURSE_COPILOT_TASKS` rows in
`src/llm/constants/ai-task-registry.constants.ts`.

## The flow

```
INTERVIEWING ──propose_blueprint──▶ AWAITING_BLUEPRINT ──Approve & build──▶ BUILDING ──all jobs settle──▶ EDITING
     ▲  ask_trainer / update_brief        update_blueprint / PUT blueprint       socket + polling            edit tools
     └──────────────────────────────── (EDIT mode starts here, bound to an existing course) ─────────────────┘
```

1. **Interview** — one question per turn through `ask_trainer` (2–4 options, one recommended, a custom
   answer always allowed). The order (seed → learners → outcomes → assessment first → shape → practice
   ladder → look → final check) lives in the prompt; the only code guard is that `propose_blueprint` is
   refused until the brief has a seed, an audience, a terminal outcome, a competency, an assessment, a
   duration and a language. The brief is a JSON document patched with `update_brief`; undeclared keys
   are dropped and reported back to the model, and `notes` can only grow.
2. **Blueprint** — one call to the planner specialist, then normalise → estimate → validate. The tree
   in the admin pane and chat edits (`update_blueprint`) both go through that same path, version-checked.
   Approval re-validates, refuses an estimate above the remaining budget, claims the status atomically
   (a double-click creates one course) and creates the DRAFT `tracks` row.
3. **Build** — one `course_copilot_jobs` row per item plus course meta, cover image, article images and
   a final reviewer. See "The build runner".
4. **Edit loop** — course-aware tools that read the live course, mutate it and save through
   `TrackService.upsertStructure`. Each change is logged and pushed to the pane as a `course_patch`.

## Architecture

| Piece | File | Notes |
|---|---|---|
| Turn loop | `service/course-copilot-orchestrator.service.ts` | Fork of the Builder interview orchestrator: two cached system blocks (prompt + platform rules; a per-session library snapshot), volatile state on the newest user turn, summarisation after 40 messages, truncation / invalid-call / empty-turn recovery, per-tool checkpointing |
| Tools | `service/course-copilot-tools.service.ts`, `course-copilot-edit-tools.service.ts` | Exposed by session state (progressive disclosure). Only `ask_trainer`, `propose_blueprint` and confirmation questions end a turn |
| Specialists | `service/specialists/*.specialist.ts` | One-shot JSON calls with narrow prompts (article, quiz, journal, annotation, course meta, reviewer, image prompt, blueprint planner, roleplay brief). Output is normalised and validated in code before it is written |
| New roleplays | `src/learn/service/agent-builder-chain.service.ts` | The admin Agent Builder field chain, server-side |
| Structure | `service/course-copilot-structure.service.ts` | Every write: Redis lock → re-read the course → mutate → `upsertStructure`. Outline, previews and the publish-readiness checklist |
| Build | `service/course-copilot-build.service.ts`, `course-copilot-job-executor.service.ts` | Runner, retries, budget hold, cancel, reconcile |
| Media | `service/course-copilot-media.service.ts` | Images via `ImageGenerationProviderFactory` → learn-media bucket under `track-media/image/` |
| Events | `service/course-copilot-event.service.ts`, `gateway/course-copilot.gateway.ts` | `/course-copilot` socket namespace |
| Prompts | `src/prompts/course_copilot/*.txt` | Synced into Prompt Management under the "Course Copilot" category; each row can carry its own model |

## The build runner

- **Durable.** Everything the runner knows is in `course_copilot_jobs`. A job claims itself with a
  conditional `queued → running` UPDATE, beats `heartbeatAt` every 30 s, and settles with a conditional
  `running → done|failed|skipped` UPDATE that carries its result. A Redis lock keeps one runner per
  session across ECS tasks, and the claim makes any overlap harmless.
- **Resumable.** `course-copilot.reconcile` (5-minute scheduler bucket) fails running jobs whose heartbeat
  is older than 10 minutes, restarts sessions with queued work and no runner, and marks a session
  `BUILD_FAILED` when its jobs died with nothing left to run. A deploy mid-build loses at most the jobs
  that were in flight, and Retry picks them up.
- **Concurrency 4**, roleplays first (they are the long pole). A new case waits for its member roleplays;
  an article image waits for its article; the reviewer runs once everything else has settled.
- **Two attempts per job.** A validator rejection is retried with the validator's own errors fed back
  to the specialist (the repair pass). A job whose dependency did not finish is **skipped**, not failed.
  `CourseCopilotJobSkip` marks environment limits (no image provider, a video with no link, a library
  roleplay since unpublished) as skipped-with-a-reason rather than failures.
- **Budget.** At every job boundary, spend (summed from `llm_usage` by `courseCopilotSessionId`, images at
  a flat rate) is compared with `budgetUsd`; over the ceiling, queued jobs become `held` and a
  `budget_hold` event asks for a raise. `POST sessions/:id/budget` refuses a figure at or below spend and
  treats 0 as uncapped — the Builder contract.
- **Where results go.** During the first build, item content stays on the job and the course is rewritten
  from the approved blueprint (debounced 2 s) so items land in blueprint order; rows added in the editor
  meanwhile are kept. Once the build finishes (`metadata.buildCompletedAt`), a retried job is inserted
  into the live course next to its nearest blueprint sibling instead, so the trainer's later edits are
  never undone by a rewrite.

## Ids

`upsertStructure` refuses an id it did not create, so the copilot cannot write blueprint ids as track ids.
The first write creates rows without ids; `trackIdMap` records what the server assigned, by position;
every later write is an update of the same rows. Nothing is soft-deleted and recreated between jobs,
which matters because learner progress rows point at item ids.

## Confirmed actions

`publish_course`, `assign_to_tenants` and `duplicate_course` are confirmed **in code**: the tool raises a
question and stores `metadata.pendingConfirmation`; it only acts when the trainer's next message answers
that question id with `confirm`, and it acts on the stored input, not on whatever the model passes the
second time. Publishing runs the readiness checklist first and returns what is missing instead of asking.

## Learner access to generated roleplays

Verified 2026-10-14: a roleplay started from a course item is authorised by the learner's unlocked
progress row and the course's `track_tenants` row (`TrackProgressService.validateRoleplayStart`); the
`scenario_tenants` check applies only to standalone roleplays. So generated roleplays are ACTIVE (a course
may only reference active roleplays), non-global and unassigned, and assigning the course is enough.
They carry `category = 'COURSE_COPILOT'` so the library can filter them.

## Configuration

| Env | Default | Notes |
|---|---|---|
| `COURSE_COPILOT_MODEL` / `COURSE_COPILOT_PROVIDER` | REASONING tier | Fallback only — set the model on the `course_copilot_interviewer_system` prompt row (Claude Sonnet recommended for tool-use reliability) |
| `COURSE_COPILOT_MAX_TOOL_ITERATIONS` | 10 | Per turn |
| `COURSE_COPILOT_SESSION_BUDGET_USD` | 15 | Per session; 0 = uncapped |
| `COURSE_COPILOT_IMAGE_COST_USD` | 0.10 | Flat per image |
| `COURSE_COPILOT_BUILD_CONCURRENCY` | 4 | |
| `COURSE_COPILOT_MAX_NEW_ROLEPLAYS` | 4 | Also capped in `COURSE_COPILOT_LIMITS` |
| `STACKS_API_URL` / `STACKS_API_KEY` | — | Design-guidance lookups soft-fail without them |
| `OPENAI_IMAGE_MODEL` / `CHARACTER_IMAGE_DEFAULT_PROVIDER` + `LEARN_MEDIA_PUBLIC_S3_BUCKET` | — | Images are skipped with a reason without them |

Limits (sections 8, items 40, new roleplays 4, new cases 2, images 12, languages per roleplay 4, two
active CREATE sessions per user) are in `constants/course-copilot.constants.ts` and enforced in code.

## Departures from the plan (plans/course-copilot-plan.md)

- **Ids are mapped, not reused** — see "Ids". The plan assumed blueprint ids could become track ids.
- **Scenario category is an enum value** (`COURSE_COPILOT`), not the free text "Course Copilot":
  `scenarios.category` is `ScenarioCategory`.
- **No scenario co-assignment** on `assign_to_tenants` — outcome A of the plan's §7.4 check.
- **Images bypass the cover-image library service**: it files every image into the roleplay cover
  library and records usage with no session id, which the budget could not see.
- **A video without a link is a warning**, skipped at build time, not an approval blocker.
- **Creating a new case from chat** is not offered in release 1 (a case needs its roleplays to exist
  first); library cases can be added.
- **Stacks client moved** to `src/llm-agent/service/stacks-client.service.ts`; Builder keeps a thin
  `BuilderStacksService` subclass.
