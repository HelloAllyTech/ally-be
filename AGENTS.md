# ally-be — start here

NestJS + TypeORM service owning the platform's primary PostgreSQL database. Node 24.

This file is a **router**: find your task below, read what it points at, skip the rest.
Conventions with a canonical home are linked, never restated — if you find a rule written
twice anywhere in this platform, that's a bug worth fixing.

## Before you touch anything user-facing

Read [Product Best Practices](https://tech.helloally.ai/#/wiki/product/best-practices.md)
and the one subsection that matches your change. Internal work — refactors, migrations,
infra, tests — is exempt. Don't read the whole product section; the hub tells you which
subsection applies.

## What am I doing?

| Task | Read first |
|---|---|
| Anything touching stored data | [`DATA_SCHEMA.md`](DATA_SCHEMA.md) — all 105 tables, plus Weaviate/Redis/SQS/S3. Start at its "Where do I find…?" index |
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

- `src/<domain>/` — controllers, services, DTOs, `entity/*.entity.ts`. 43-ish feature modules.
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
architecture, SDLC rules, and product practice —
[this repo's page](https://tech.helloally.ai/#/wiki/repos/ally-be.md) ·
[architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md) ·
[contributing](https://tech.helloally.ai/#/wiki/contributing/guide.md) ·
[how the docs system works](https://tech.helloally.ai/#/wiki/contributing/docs-system.md).

> ⚠️ The wiki is **public**. Never add secrets, credentials, IP addresses, internal
> hostnames/domains, or cloud region details to it.
