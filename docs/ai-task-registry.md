# The AI task registry

**If you add, remove or re-point an AI call anywhere on this platform, you update
`src/llm/constants/ai-task-registry.constants.ts` in the same PR.**

That file is the canonical list of every action — learner, admin, or scheduled —
that reaches a model over an API, and which model serves it. It is served
read-only at `GET /v1/llm/tasks` and rendered as the **AI Tasks** tab in the
admin console.

This page explains the shape and the rules. It deliberately does **not** repeat
the list: one copy, in code, next to the enum it is keyed on.

## Why this exists

The mapping used to be reconstructable only by reading four repos at once
(`ally-be`, `ally-ai`, `ally-ai-learn`, and the workflow files), which meant in
practice nobody did. Two things went wrong as a result:

- Features shipped without anyone knowing what they cost per invocation.
- Model defaults drifted apart with no one place that would show it. `ally-ai`
  is still pinned to `gpt-4o-mini-2024-07-18` while `ally-be` autofill moved to
  `gpt-5-mini`; some of those pins are deliberate and some are simply stale, and
  before the registry there was nothing that made the difference visible.

## What counts as a row

Any call to a model over a vendor API. Not only chat completions — embeddings,
transcription, speech synthesis and image generation each get a row, tagged with
`kind`, because they bill differently and a chart that mixes them is unreadable.

One row per **call site with a distinct purpose**, not per function. Three
autofill entry points that share a model still get three rows, because "what
triggers it" differs and that is the column people read. Conversely, a retry of
the same call is not a second row.

## Adding a row

```ts
{
  id: 'track-quiz-grading',            // stable, kebab-case, never reused
  task: LlmTask.TRACK_QUIZ_GRADING,    // or null if the call records no usage
  runtime: LlmRuntime.ALLY_BE,         // which service executes it
  trigger: 'A learner submits an open-ended quiz answer',
  detail: "Graded against the item's rubric.",
  kind: AiTaskKind.COMPLETION,
  provider: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
  configuredBy: 'ANTHROPIC_AUTOFILL_MODEL',
  configPath: 'anthropic.autofillModel',   // ally-be rows only — see below
}
```

Field notes worth reading before you guess:

- **`trigger`** is written for someone outside the codebase. "A learner submits
  an open-ended quiz answer", not `gradeQuizAnswer()`. This is the column the
  table leads with and the reason the screen is legible at all.
- **`detail`** carries cadence and constraint — "one call per committed learner
  turn", "runs concurrently with the answer call", "pinned at temperature 0".
  Put the *why* here when a model choice looks odd; the next person to consider
  changing it will read this and not the git log.
- **`task: null`** documents calls that predate the `LlmTask` enum. It is not
  permission to skip usage recording on a **new** call — add a task label.
- **`configPath`** is a `getter.property` path into `AppConfigService`, and only
  meaningful for `ALLY_BE` rows. It makes the screen show what *this deployment*
  is configured for rather than what the repo happens to say. ally-ai and
  ally-ai-learn read their own env in their own containers; ally-be cannot see
  it, so those rows are returned as `documented` and the UI labels them.
- **`promptOverride`** names the prompt row whose own provider/model beats
  `configuredBy`. Set it on any call that reads
  `PromptSharedService.getPromptLlmConfig` — the autofill trio, the character
  interview, coaching chat, agent-template translation, the WhatsApp answer.
  **When you set it, `provider` and `defaultModel` on that row are the fallback,
  not a fixed fact**, and if the prompt row can select models from more than one
  vendor the row must say `provider: 'resolved'` rather than assert one. Use the
  exact prompt code (check the `prompts` table — the WhatsApp answer prompt is
  `ally_ai_knowledge_whatsapp_answer`, not `whatsapp_answer`); a code that does
  not exist sends an admin looking for a row that is not there. A free-text
  phrase is allowed only where the prompt genuinely varies per invocation, as it
  does for the autofill calls.
- **`hotPath: true`** marks a call inside a live voice turn, where latency is
  user-visible. Set it honestly — it is what someone filters on when a session
  feels slow.

## The models here are defaults, not facts

A model id resolves at request time through four layers, later winning:

1. the code default in this registry,
2. `languages.llmConfigId` → `llm_configs.config`,
3. `prompts.model` / `prompts.temperature` (editable from Prompt Management),
4. an explicit override on the request or the simulation.

See [`prompt-llm-config-standardization-adr.md`](./prompt-llm-config-standardization-adr.md).
Two guards bite here and belong in `detail` when they apply: a prompt-level
model is dropped when its provider cannot run in the consuming runtime
(ai-learn has no Anthropic branch; the report evaluator is OpenAI-only), and
`temperature` is stripped for reasoning models (`o1/o3/o4`, `gpt-5*`), which
reject any non-default value.

## What enforces this

Documentation that only asks nicely goes stale. Three things make the rule hold:

| Guard | Catches |
|---|---|
| `src/llm/service/test/ai-task.service.spec.ts` | A new `LlmTask` member with no row. A duplicate `id`. A `configPath` pointing at a renamed config getter. A malformed `promptOverride` code. A row asserting a vendor for a call whose provider is chosen per prompt. |
| `.docs-map.yml` rule `ai-task-registry` | A PR that touches an LLM client call site without touching the registry. |
| This page | The shape, and the judgement calls a test cannot make. |

None of them catches a call added with no new task label and no new client
file — a fourth `messages.create` inside a service that already has three. That
one is on review, which is why `trigger` and `detail` are worth writing
properly: a reviewer who can read the row can tell whether it is missing.

## Removing or re-pointing a call

Delete the row, or change `defaultModel` and `configuredBy` together. Do not
leave a row for a call that no longer happens — an over-complete registry is
worse than an incomplete one, because it reads as authoritative while quietly
costing nothing.

If you retire a `LlmTask` member, remove its row too; historical `llm_usage`
rows keep the string and are unaffected.
