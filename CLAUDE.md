# CLAUDE.md

Guidance for Claude Code when working in **ally-be** — the Ally backend API.

## What this repo is

NestJS + TypeORM service that owns the platform's **primary PostgreSQL database**. Feature modules
live under `src/<domain>/` (controllers, services, DTOs, and `entity/*.entity.ts`). Schema changes
ship as TypeORM migrations in `src/database/migrations/` (`synchronize: false`); config in
`src/database/data-source.ts`.

It is one of several repos in the wider Ally workspace (siblings include `ally-ai` — the Python
conversational-AI service that owns the Weaviate vector DB — plus `ally-web` and `ally-mobile`
clients). SQS and LiveKit bridge `ally-be` and `ally-ai`.

## Data schema reference

**[DATA_SCHEMA.md](DATA_SCHEMA.md) — read this before building any feature or analytics that
touches stored data.** It maps *what data exists and where it lives* across all stores:

- PostgreSQL (105 TypeORM tables in this repo) — grouped by domain, with key columns, enums,
  multi-tenancy/soft-delete conventions, and join-table patterns.
- Weaviate vector collections in `ally-ai` (`Conversation`, `ReferenceDocument`).
- Redis, AWS SQS, AWS S3, and LiveKit — what each holds and how rows point at S3 objects.
- A "Where do I find…?" quick index and the cross-store links between Postgres and Weaviate.

The code is the source of truth (`src/**/entity/*.entity.ts`, plus
`ally-ai/app/core/vector_db/constants.py` in the AI repo); keep `DATA_SCHEMA.md` updated when
schemas change.
