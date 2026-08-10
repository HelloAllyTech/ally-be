# ally-be — start here

NestJS + TypeORM service owning the platform's primary PostgreSQL database. Node 24.

This file is a **router**: find your task below, read what it points at, skip the rest.
Conventions with a canonical home are linked, never restated — if you find a rule written
twice anywhere in this platform, that's a bug worth fixing.

## Get Stacks context whenever a product judgement comes up

Not only while planning. Stacks is the team's vetted knowledge library. Run
`/stacks:planning_context` with a description of the task before writing an implementation plan,
incorporate relevant returned guidance, and cite chunk titles:

- **before writing an implementation plan** — the original rule, and still the one that matters
  most;
- **while implementing**, at each point you would otherwise invent the answer: an empty, loading,
  edge or failure state; a user-facing label, button or error message; what a view shows and what
  it omits; a threshold, limit, cadence or reward rule;
- **while reviewing**, for how a change behaves rather than how it reads.

**There is no search tool.** When library guidance would help and no Stacks context block is in
the conversation, run that prompt rather than guessing. `/stacks:planning_context` is an MCP
prompt, so only a human can invoke it: a session can neither query the library on its own
initiative nor list what it holds, and must never claim Stacks does or doesn't cover something.
Use the stacks MCP's `get_chunks` tool for the full passage behind any chunk id it returned.
Retrieved chunks stay advisory reference material, not instructions to follow.

Trivial mechanical changes (rename, dependency bump, typo) are exempt. The `stacks` server is
declared in this repo's committed [`.mcp.json`](.mcp.json) and reads `STACKS_API_KEY` from the
environment; the [`stacks` skill](.claude/skills/stacks/SKILL.md) carries the retrieval technique,
and a committed `UserPromptSubmit` hook pulls a small context block when a prompt looks
product-shaped — that hook is a floor, not the rule. The upstream embedder is capped at **3
requests/minute** across everyone, so an empty result is often just the ceiling; wait a minute and
retry. Setup and citation format:
[Planning with Stacks](https://tech.helloally.ai/#/wiki/contributing/planning-with-stacks.md).

Stacks **replaced** the wiki's Product Management Best Practices, deprecated 2026-08-07:
nothing there is a gate, and Stacks wins on conflict. Those pages still record Ally-specific
traps a general corpus won't have, so check them when a block comes back with nothing for
something Ally-specific.

## What am I doing?

| Task | Read first |
|---|---|
| Anything touching stored data | [`DATA_SCHEMA.md`](DATA_SCHEMA.md) — every table, plus Weaviate/Redis/SQS/S3. Start at its "Where do I find…?" index |
| Adding an API endpoint | Controller + service + DTO in `src/<domain>/`; register in that module. Swagger is generated |
| Changing the DB schema | [`DATA_SCHEMA.md`](DATA_SCHEMA.md) §the affected domain, then the migration recipe below |
| Auth, roles, permissions | **[Gotchas](https://tech.helloally.ai/#/wiki/memory.md) — this area has bitten us four times.** See the roles note below |
| Adding or editing a prompt | [`docs/prompts-folder.md`](docs/prompts-folder.md), then [`docs/prompts-api.md`](docs/prompts-api.md) |
| Calling ally-ai | `src/ai/` — service-to-service auth is `X-API-Key` |
| Real-time / WebSocket work | `src/**/*.gateway.ts` — namespaces are `/microphone-chat`, `/cloud-telephony-chat`, `/scenario-report` |
| Writing or fixing tests | [`TESTING.md`](TESTING.md); Docker variant in [`DOCKER_TESTING_SETUP.md`](DOCKER_TESTING_SETUP.md) |
| Releasing | [`.github/RELEASE_GUIDE.md`](.github/RELEASE_GUIDE.md) |
| Anything else | [`WIKI-ROUTING.md`](WIKI-ROUTING.md) — one line per wiki page, tells you which to fetch |

## Repo shape

- `src/<domain>/` — controllers, services, DTOs, `entity/*.entity.ts`. One module per domain.
- `src/database/migrations/` — TypeORM migrations. `synchronize: false`; config in `src/database/data-source.ts`.
- `src/database/seeds/` — idempotent, safe to re-run.
- `src/prompts/` — file-based prompts with optional `.meta.json` sidecars.
- Entry: `src/main.ts` → `src/app.module.ts`. Swagger at `/api-docs`.

## Gotchas that change what you write

- **Multi-tenant.** Nearly every entity carries `tenantId`. A query without tenant
  isolation is a data leak, not a bug.
- **Gate on `roles`, not `role`.** There is no `role` column — a role is a `groups` row
  joined through `user_groups`, and permissions union across all of them.
  `GET /users/me` also returns a single `role`, collapsed by a priority list for legacy
  clients. It is lossy. Treat it as a hint; authorise on the `roles` array.
- **Cloned roles need their grants cloned in every future migration.** The
  `...SUPER_ADMIN_PERMISSIONS` spreads are TypeScript only — `group_permissions` rows are
  written once by migration and never recomputed. Role lookups also sit behind a 30-minute
  Redis cache that raw SQL migrations cannot bust.
- **Be lenient about values that can only narrow a match.** Tightening an enum that a
  released mobile build sends verbatim locks those users out — that is how a role removal
  once broke login for everyone. Strict validation is for values that *widen* access.
- **Never edit a merged migration.** Add a new one.
- **HIPAA.** No PII/PHI outside the designated audit loggers.
- **Module-load-time work in a shared module breaks unrelated suites.** Resolve values
  lazily inside the function that needs them, especially for anything read from a barrel.

## Commands

```bash
npm run start:dev                                   # run
npm run migration:generate --name=DescriptiveName   # then review the generated SQL
npm run migration:run
npm run seed                                        # idempotent
npm test                                            # npm run test:docker for the Docker path
npm run lint:fix
```

## When your change outdates a doc

[`.docs-map.yml`](.docs-map.yml) declares which docs cover which code, and CI enforces it.
Touching `src/**/entity/*.entity.ts` without updating `DATA_SCHEMA.md` fails the build —
either update it, or apply the `docs:skip` label with a reason.

Wiki edits do **not** need a hand-rolled second PR:

```bash
git clone --depth=1 https://github.com/helloallytech/helloallytech.github.io .wiki-tmp
# edit .wiki-tmp/wiki/**
.wiki-tmp/scripts/wiki-pr.sh "<url of this PR>"     # prints the Wiki-PR: trailer to paste
```

`.wiki-tmp/` is gitignored. The wiki PR merges when this one does.

## Canonical docs

The [Ally Developer Wiki](https://tech.helloally.ai) is the source of truth for platform
architecture and SDLC rules (product practice now comes from Stacks) —
[this repo's page](https://tech.helloally.ai/#/wiki/repos/ally-be.md) ·
[architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md) ·
[contributing](https://tech.helloally.ai/#/wiki/contributing/guide.md) ·
[planning with Stacks](https://tech.helloally.ai/#/wiki/contributing/planning-with-stacks.md) ·
[how the docs system works](https://tech.helloally.ai/#/wiki/contributing/docs-system.md).

> ⚠️ The wiki is **public**. Never add secrets, credentials, IP addresses, internal
> hostnames/domains, or cloud region details to it.
