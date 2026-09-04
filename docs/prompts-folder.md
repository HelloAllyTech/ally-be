# Prompts folder (src/prompts)

Prompt template files (`.txt`) in `src/prompts/` are synced to the database on startup. This doc covers naming, structure, optional meta JSON, and how to add a new prompt.

## Naming Standards

**File and path names must be descriptive.** They drive the prompt's display name and description in the Dashboard. Generic names (e.g. `system`, `text`, `user`) produce confusing labels.

### Rules

| Rule | Example | Avoid |
|------|---------|-------|
| Use `snake_case` | `code_mixed_system.txt` | `system.txt` |
| Filename must describe purpose | `general_text_translation.txt` | `text.txt` |
| Minimum: subdir + descriptive filename | `openai_translation/speech_reexpression_user.txt` | `openai_translation/user.txt` |
| Combine generic terms with context | `translation_system_prompt.txt` | `system.txt` |

### Why

- The path `subdir/filename` becomes `promptCode` = `subdir_filename` (e.g. `openai_translation_code_mixed_system`)
- Display names are derived from `promptCode` via `formatLabel`
- Generic filenames like `system`, `text`, `user` yield unclear names in the UI

## Structure

```
src/prompts/
├── openai_simulation/
│   ├── _meta/                    # optional: .meta.json for name/description
│   │   └── character_profile_text.meta.json
│   ├── character_profile_text.txt
│   ├── challenge_description.txt
│   └── ...
├── openai_translation/
│   ├── _meta/
│   │   └── guardrail_translation.meta.json
│   ├── code_mixed_system.txt
│   ├── speech_reexpression_user.txt
│   └── ...
├── builder/
│   ├── _meta/
│   │   └── interviewer_system.meta.json
│   └── interviewer_system.txt
└── ux_signals/
    ├── _meta/
    │   └── triage.meta.json
    └── triage.txt
```

### Agent system prompts

A folder like `builder/` (or `character_interview/`, `roleplay_copilot/`) holds the *system*
prompt for a long-running agent rather than a one-shot generation. Two things differ:

- It is read by code through `PromptSharedService.getPromptByCode('<folder>_<file>')`, not
  picked by a human in the Admin Dashboard — so the `_meta` name and description are for
  whoever later goes looking for it, not for a chooser.
- The service must **degrade to a hardcoded fallback when the row is missing**, because a
  prompt that has not been synced to the database yet would otherwise take the whole agent
  down. Copy that pattern rather than throwing; the agent working slightly worse beats the
  tab not opening.

### Code-read one-shot prompts

A third shape sits between the two: a folder like `analytics_suggestions/` or `ux_signals/`
holds the system prompt for a **single** call that a feature makes on demand, read through
`getPromptByCode` like an agent prompt but not driving a conversation.

These deliberately do **not** degrade to a hardcoded fallback — they throw when the row is
missing. The reasoning is the opposite of the agent case: an agent answering slightly worse
still serves its user, whereas one of these produces a batch of stored items (roadmap
suggestions, bug findings) that a human will later act on believing a reviewed prompt
produced them. Silently falling back would put unattributable rows in a review queue, so
failing the run is the safer answer. Follow whichever pattern matches what your prompt's
output becomes, not whichever folder you copied.

### Stateless conversational prompts

A fourth shape looks like an agent prompt but is read like a one-shot: `roadmap/opportunity_interview.txt`
drives a multi-turn interview, yet each turn is an independent `getPromptByCode` call with the
whole transcript rendered into the user message. There is no session table and no message rows,
so nothing needs replaying and there are no `tool_use` blocks to keep paired — the trap
`rebuildAnthropicHistory` exists for in the Builder and Character interviews.

Two rules matter when writing one:

- **Speaker-label the transcript** you render in (`ADMIN:` / `YOU:`). Without it the model
  cannot tell its own previous questions from the answers and starts re-asking them.
- **If the prompt grades anything that later gates a write, grade the write's own criteria** —
  the same constant, the same ids. `opportunity_interview.txt` reports on
  `ROADMAP_READINESS_CRITERIA` because its draft is filed with a signed readiness token, and a
  prompt marking its own private rubric would be a signature over a check nobody ran. If you
  edit the criteria, the interview follows automatically; if you edit the prompt to grade
  something else, you have broken the gate rather than the interview.

Prompts that a *runner* fetches over HTTP mid-run (Builder's build protocol) are not in this
folder at all — they are TypeScript builders under `src/<domain>/constants/`, because they are
assembled per run from live state rather than being static text.

## Meta JSON (optional)

You can override the **display name** and **description** shown in the Admin Dashboard by adding a `.meta.json` file in a dedicated `_meta` folder next to your prompts. This keeps the prompt directory uncluttered (only `.txt` files at the top level).

**Location:** For each prompt file `subdir/<stem>.txt`, add:

```
subdir/_meta/<stem>.meta.json
```

**Schema:** JSON object with optional `name`, `description`, and `category` (strings). If a key is missing or empty, the sync falls back to the path-derived value (via `formatLabel`).

**Example:** For `openai_translation/guardrail_translation.txt`, create `openai_translation/_meta/guardrail_translation.meta.json`:

```json
{
  "name": "Guardrail Translation",
  "description": "Localizes conversational guardrails for role-play into natural spoken language. Preserves JSON structure and Markdown.",
  "category": "Translation"
}
```

- **When sync runs** (app startup or POST `/api/v1/prompts/sync`), the service reads each prompt's `.meta.json` if present and uses it for `name` and `description` in the database.
- **Dashboard:** The Admin Dashboard (ally-web) displays these names and descriptions. Editing name/description in the dashboard is overwritten on the next sync; prompt **content** is not (dashboard edits are stored in versions).

## Adding a New Prompt

1. Create a `.txt` file under the right subdir with a **descriptive** name
2. Restart the app — `PromptsSyncService` will sync on startup (name/description derived from path)
3. In code, use `toPromptCode(subdir, filename)` when fetching the prompt:
   ```ts
   import { toPromptCode } from 'src/prompt/util/prompt-code.util';
   const prompt = await promptSharedService.getPromptByCode(
     toPromptCode('openai_simulation', 'my_new_prompt'),
   );
   ```
4. Optionally add `subdir/_meta/<stem>.meta.json` for a custom name/description (see [Meta JSON](#meta-json-optional) above).

## See also

- [Prompts API (dashboard & sync)](./prompts-api.md) — How the dashboard and other services use the prompt API.
