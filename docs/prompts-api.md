# Prompts API (dashboard & sync)

This doc describes how prompt templates are exposed to the **Admin Dashboard** (ally-web) and to other services (e.g. ally-ai-learn) via the API.

## How prompts reach the dashboard

1. **Source of truth (codebase):** Prompt `.txt` files live in `src/prompts/` (see [Prompts folder](./prompts-folder.md)). Optional `_meta/<stem>.meta.json` files provide display **name** and **description**.
2. **Sync on startup:** `PromptsSyncService` runs when the app starts. It scans `src/prompts/`, reads each `.txt` (and any `.meta.json`), and syncs to the database:
   - **New** prompt codes → new row + version 1.
   - **Existing** prompt codes → only `defaultPrompt`, `name`, and `description` are updated. **Dashboard-edited content is not overwritten** (it lives in `prompts_versions`; sync does not change `currentVersion`).
3. **Dashboard:** The Admin Dashboard calls the APIs below to list, view, edit, and revert prompts. It shows the **current version** (or codebase default when "Use dashboard version" is off).

## API overview

Base path: **`/api/v1/prompts`**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/prompts` | Bearer (VIEW_PROMPT) | List prompts (paginated, sortable, searchable). |
| GET | `/api/v1/prompts/by-codes?codes=code1,code2` | Bearer (VIEW_PROMPT) | Get prompt **content** by codes (e.g. for ally-ai-learn). Returns `Record<promptCode, content>`. |
| POST | `/api/v1/prompts` | Bearer (EDIT_PROMPT) | Create new prompts (bulk). |
| POST | `/api/v1/prompts/sync` | **x-api-key** (AI key) | Sync from payload (used by deployment/ally-ai-learn). Add new prompts; for existing, updates only `defaultPrompt`, `name`, `description`. |
| GET | `/api/v1/prompts/by-type/:promptType` | Bearer (VIEW_PROMPT) | List the variants of one `promptType` (e.g. `main_agent`) for the studio pickers. Includes variants with `visibleInStudio=false` — see below. |
| PUT | `/api/v1/prompts/:id` | Bearer (EDIT_PROMPT) | Update a prompt (name, description, content, useDashboardOverride, visibleInStudio). Creating a new version only when content is updated and useDashboardOverride is true. |
| GET | `/api/v1/prompts/:id/usage` | Bearer (VIEW_PROMPT) | Count + sample (≤10) of scenarios referencing this prompt. The `scenarios.metadata` key searched follows `promptType`: `selectedEvaluatorPromptCode` for `transcript_evaluator`, `selectedMainPromptCode` otherwise. |
| POST | `/api/v1/prompts/:id/revert` | Bearer (EDIT_PROMPT) | Revert prompt to codebase default (copies `defaultPrompt` into a new version and sets it as current). |

## Authentication

- **Dashboard (user):** Endpoints other than `POST /sync` use **Bearer token** (access token) and require:
  - `VIEW_PROMPT` for GET list and by-codes.
  - `EDIT_PROMPT` for create, update, revert.
- **Sync (automation):** `POST /api/v1/prompts/sync` uses **x-api-key** (AI API key), not Bearer. This is for deployment scripts and ally-ai-learn's `scripts/sync_prompts.py`.

## Using the API from the dashboard (ally-web)

The Admin Dashboard typically:

1. **List prompts:** `GET /api/v1/prompts?limit=20&offset=0&sortBy=name&order=ASC&searchName=...`
2. **Open one prompt:** Uses the same list payload; the selected row's `id` and version info are used for edit.
3. **Update prompt:** `PUT /api/v1/prompts/:id` with body `{ name?, description?, prompt?, useDashboardOverride? }`. If `prompt` is sent and `useDashboardOverride` is true, a new version is created.
4. **Revert to default:** `POST /api/v1/prompts/:id/revert`

## Using the sync endpoint (e.g. ally-ai-learn)

From a deployment pipeline or ally-ai-learn:

```bash
curl -X POST "https://<ally-be-host>/api/v1/prompts/sync" \
  -H "x-api-key: <AI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompts": [
      {
        "promptCode": "ally_ai_learn_system_default_system_prompt",
        "name": "Default System Prompt (Client)",
        "description": "Defines the AI as the client in counselor-training role-play.",
        "prompt": "You are an AI roleplay assistant...",
        "availableVariables": ["language_code"]
      }
    ]
  }'
```

Response: `{ "added": 0, "updated": 1 }` (or added/updated counts).

- **promptCode:** Unique code (e.g. from path: `subdir_filename` or `ally_ai_learn_subdir_filename`).
- **name / description:** Shown in the dashboard; can be overridden by `.meta.json` in ally-be/ally-ai-learn.
- **prompt:** Full template body (stored as `defaultPrompt` and, for new prompts, as version 1).
- **availableVariables:** Optional; list of placeholder names (e.g. `{var_name}`) for the UI.

## Resolving prompt content at runtime

Other services (e.g. learn, translation) resolve content by **promptCode** via `PromptSharedService.getPromptByCode(promptCode)`:

- If the prompt has **useDashboardOverride = true:** content is read from the **current version** in the DB (dashboard-edited).
- If **useDashboardOverride = false:** content is read from the **folder** `src/prompts/` (or from `defaultPrompt` depending on implementation). So after a deploy, folder content wins for non-override prompts.

This keeps dashboard edits safe on deploy while still allowing "use codebase" per prompt.

## Studio visibility (`visibleInStudio`)

A per-prompt switch, edited in the admin's prompt side panel ("Studio availability"), that
controls whether the studio's variant pickers **offer** this prompt:

- `main_agent` variants → the Skill Version dropdown on Create/Edit Simulation.
- `transcript_evaluator` variants → the evaluator dropdown on the report section.

It is a **future-visibility switch, not a capability toggle**, and the distinction is the whole
design:

- **No runtime path reads it.** A scenario carries its choice in
  `metadata.selectedMainPromptCode` / `metadata.selectedEvaluatorPromptCode`; session start
  resolves that code directly. Hiding a variant therefore cannot affect a roleplay already using
  it — it keeps running on the same prompt, with the same version and translations.
- **`by-type` still returns hidden rows.** Most readers of that list resolve an
  *already-selected* code to its name, states and `availableVariables`. Filtering server-side
  would make a hidden-but-in-use variant unresolvable and degrade the editor for exactly the
  scenarios hiding is meant to leave alone. Only the two pickers that offer a choice filter, and
  each keeps the variant its own form is currently on, labelled `(hidden)`, so saving can never
  silently reassign a simulation to a different skill.
- **`DEFAULT true`, no backfill, and `POST /sync` never writes it.** Existing prompts stay
  visible, new duplicates start visible, and a redeploy can't un-hide an admin's decision.
- **Distinct from `isObsolete`,** which is owned by the file-sync lifecycle (the `.txt`
  disappeared) and gates deletion. Hiding a variant must not make it deletable.

There is deliberately no guard against hiding the default variant or hiding every variant: with
nothing on offer the picker says so, leaves the field unset, and the runtime falls back to the
default `main_agent` prompt. `GET /:id/usage` backs the panel's "N simulations already using it
keep running on it" line — the switch warns, it never blocks.

## See also

- [Prompts folder (naming, structure, meta JSON)](./prompts-folder.md)
