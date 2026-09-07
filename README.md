# Ally Backend Service

A multi-tenant, AI-powered backend platform for mental health counselor training built with NestJS. It connects counselors and learners through real-time voice communication, scenario-based simulations, AI-driven feedback, and comprehensive analytics.

## Overview

Ally Backend is the core API and event-processing service that:

- **Powers scenario-based learning** with simulated client conversations and learning pathways
- **Provides real-time communication** via WebSocket gateways and LiveKit voice/video rooms
- **Processes audio and transcriptions** through an async pipeline using AWS SQS and S3
- **Delivers AI-driven insights** including call summaries, live nudges, and session reports via LLM integration
- **Enforces conversational guardrails** to detect boundary violations in real time
- **Manages multi-tenant access** with role-based permissions, groups, and tenant isolation
- **Supports gamification** through a badge and community leaderboard system
- **Integrates with AWS** (S3, SQS, SES, CloudWatch) for storage, messaging, email, and audit logging
- **Exposes a versioned REST API** with Swagger/OpenAPI documentation

## Architecture

The system is organized as a modular NestJS monolith with the following key layers:

### Key Components

- **REST API** (`src/*/controllers`) - Versioned endpoints (`/api/v1/`) with JWT and API key authentication
- **WebSocket Gateways** - Real-time communication for microphone chat (`/microphone-chat`), audio ingestion (`/audio-ingest`), and scenario reporting (`/scenario-report`)
- **LiveKit Integration** (`src/livekit/`) - Voice/video room lifecycle, participant tracking, agent dispatch, and webhook handling
- **Audio Pipeline** (`src/audio/`, `src/audio-ingest/`) - Multipart S3 upload, SQS-based transcription requests, and DLQ handling
- **AI / LLM Service** (`src/ai/`, `src/ai-chat/`) - Streaming LLM responses via OpenAI, session summarization, and event analysis
- **Conversational Guardrails** (`src/conversational-guardrails/`) - Real-time boundary detection with multi-language support
- **Prompt Management** (`src/prompt/`, `src/prompts/`) - Versioned system prompts with dashboard sync and external override resolution
- **Scenario Engine** (`src/learn/`, `src/scenario-path/`) - Scenarios, learning pathways, and session management
- **Review Systems** (`src/scenario-session-review/`, `src/scribe-session-review/`) - Threaded comments, reactions, and badge awards on sessions
- **Message Broker** (`src/message-broker/`) - Redis pub/sub for inter-service events
- **Scheduler** (`src/scheduler/`) - Periodic background jobs via `@nestjs/schedule`
- **Analytics** (`src/analytics/`) - Metabase integration for dashboards and tenant-specific reporting

### Technology Stack

| Component      | Tech Used                                  |
| -------------- | ------------------------------------------ |
| Backend        | NestJS (Node.js v24)                       |
| Database       | PostgreSQL + TypeORM                       |
| Caching        | Redis                                      |
| Real-time Comm | WebSocket (Socket.io) + LiveKit            |
| Authentication | JWT, OTP, Google OAuth, Magic Link         |
| AI / LLM       | OpenAI (streaming), Deepgram (STT)         |
| TTS            | ElevenLabs, Deepgram, Sarvam, Google, Hume |
| Cloud Storage  | AWS S3 (multipart, presigned URLs)         |
| Messaging      | AWS SQS + Redis message broker             |
| Email          | AWS SES                                    |
| Audit Logging  | AWS CloudWatch (HIPAA-compliant)           |
| Analytics      | PostgreSQL + Metabase                      |
| Observability  | Winston Logger + Slack alerts              |
| Documentation  | Swagger/OpenAPI                            |

## Codebase Directory Structure

```
ally-be/
├── src/
│   ├── ai/                              # LLM integration (OpenAI), session summarization, event analysis
│   ├── ai-chat/                         # AI chat interfaces and provider abstraction
│   ├── analytics/                       # Metabase integration and tenant analytics dashboards
│   ├── app-version/                     # App version management
│   ├── audio/                           # Audio file storage and processing utilities
│   ├── audio-ingest/                    # SQS-based async transcription pipeline and DLQ handling
│   ├── audit/                           # Audit logging (AWS CloudWatch, HIPAA-compliant)
│   ├── auth/                            # JWT, OTP, Google OAuth, Magic Link authentication
│   ├── authorization/                   # RBAC guards and permission decorators
│   ├── aws/                             # AWS S3, SQS, SES service wrappers
│   ├── badge/                           # Badge definitions, award logic, bulk and auto awarding
│   ├── case/                            # Case management and tenant-isolated case items
│   ├── chat/                            # Chat session tracking
│   ├── common/                          # Shared utilities, interceptors, and decorators
│   ├── community/                       # Leaderboard and user ranking
│   ├── config/                          # Application configuration
│   ├── conversational-guardrails/       # Real-time boundary detection with multi-language support
│   ├── database/                        # TypeORM data source, migrations, and seed scripts
│   ├── exception/                       # Global exception filters
│   ├── factory/                         # Factory classes for testing
│   ├── health/                          # Health check endpoint
│   ├── language/                        # Language settings and translation service
│   ├── learn/                           # Scenario engine, learning pathways, and session management
│   ├── livekit/                         # LiveKit room lifecycle, participant tracking, and webhooks
│   ├── logger/                          # Winston logger configuration
│   ├── message-broker/                  # Redis pub/sub for inter-service events
│   ├── notification/                    # Email and push notification delivery (AWS SES)
│   ├── place/                           # Location and place data
│   ├── prompt/                          # Prompt management and dashboard sync
│   ├── prompts/                         # Versioned system prompt definitions
│   ├── queue/                           # SQS queue setup and configuration
│   ├── rate-limit/                      # Request rate limiting
│   ├── redis/                           # Redis client configuration
│   ├── reference-document/              # Reference materials associated with scenarios or pathways
│   ├── review/                          # Shared review utilities
│   ├── scenario-character/              # Scenario NPC/character (client persona) definitions
│   ├── scenario-cover-image-library/    # Scenario cover image management
│   ├── scenario-path/                   # Learning pathway composition
│   ├── scenario-report/                 # Real-time scenario reporting WebSocket gateway
│   ├── scenario-session-review/         # Threaded comments, reactions, and badge awards on sessions
│   ├── scheduler/                       # Periodic background jobs (@nestjs/schedule)
│   ├── scribe-session-review/           # Transcript-based feedback with threaded comments
│   ├── session-event/                   # Session event tracking and storage
│   ├── settings/                        # Application settings management
│   ├── tenant/                          # Multi-tenant management and isolation
│   ├── user/                            # User profiles and management
│   └── voice-preview/                   # TTS voice preview (ElevenLabs, Sarvam, Google, Hume)
├── docs/                                # Additional documentation (prompts API, folder conventions)
├── test/                                # End-to-end tests
├── .env.example                         # Local development environment template
├── docker.env.example                   # Docker Compose environment template
├── docker-compose.yml                   # Infrastructure services (Postgres, Redis, LocalStack, SQS)
├── Makefile                             # Convenience make targets
├── nest-cli.json                        # NestJS CLI configuration
├── tsconfig.json                        # TypeScript configuration
└── package.json                         # Dependencies and npm scripts
```

## Prerequisites

Before you begin, ensure you have the following installed:

### Required Software

- **Node.js** (v24) - [Download](https://nodejs.org/)
- **npm** - Comes with Node.js
- **Docker** (v20.10 or higher) - [Download](https://www.docker.com/get-started)
- **Docker Compose** (v2.0 or higher) - Usually included with Docker Desktop
- **PostgreSQL** (v14 or higher) - For local development (optional, Docker recommended)
- **Redis** - For local development (optional, Docker recommended)

### Required Accounts & API Keys

- **LiveKit Account** - For WebRTC audio/video calls ([Sign up](https://livekit.io/))
- **OpenAI Account** - For LLM-powered summaries, guardrail detection, and translations
- **Deepgram Account** - For speech-to-text transcription
- **AWS Account** (optional) - For S3, SQS, SES, CloudWatch (LocalStack can be used for local dev)
- **Metabase** (optional) - For analytics dashboards
- **Slack** (optional) - For exception alerts

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ally-be
```

### 2. Configure Environment

Copy the sample environment files:

```bash
cp docker.env.example docker.env
cp .env.example .env
```

Edit `docker.env` and `.env` with your credentials. See [Environment Configuration](#-environment-configuration) for details.

### 3. Start Infrastructure Services

Start PostgreSQL, Redis, LocalStack, and SQS using Docker Compose:

```bash
docker-compose up
```

Make sure the SQS URLs in your `.env` file match the ones shown in the Docker output.

> **Note**: The app service in Docker requires manual execution. Follow the steps below to run it.

### 4. Run Database Migrations

```bash
npm run migration:run
```

### 5. Start the Application

```bash
npm run start:dev
```

The application will be available at:

- **Swagger Docs**: http://localhost:8001/api-docs
- **Health Check**: http://localhost:8001/api/health

#### Production Mode

```bash
npm run build
npm run start:prod
```

## 📦 Environment Configuration

The application uses two environment files:

1. **`.env`** - For local development (running without Docker)
2. **`docker.env`** - For Docker Compose setup

Refer to `.env.example` and `docker.env.example` for all available configuration options.

> **Note**: The `docker.env` file is used by Docker Compose services. The `.env` file is used when running the app directly with `npm run start:dev`.

## 🗄️ Database Management

### Migrations

```bash
# Generate a new migration
npm run migration:generate --name=YourMigrationName

# Create an empty migration file
npm run migration:create --name=YourMigrationName

# Run pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert

# Show migration status
npm run migration:show
```

### Database Connection

- **Host**: `localhost` (or `postgres` in Docker)
- **Port**: `5477` (mapped from container's `5432`)
- **Database**: Value from `DB_DATABASE` in `docker.env`
- **Username**: Value from `DB_USERNAME` in `docker.env`
- **Password**: Value from `DB_PASSWORD` in `docker.env`

### Database Seeding

Seeds live in `src/database/seeds/` and insert the minimum dataset needed for local development directly via TypeORM (no running server required). The fixture data is inline TypeScript in [`fixtures.ts`](src/database/seeds/fixtures.ts) — edit it there if you need to add/change seeded records.

What gets seeded:

- 4 tenants — `ally` (internal/demo), two active paying customers
  (`northwind-behavioral-health`, `riverside-wellness-center`), one
  SUSPENDED (`brightpath-counseling`)
- 22 users spanning every role, across all 4 tenants, including account edge
  cases (never-logged-in, onboarding incomplete, individually suspended)
- Platform admins: `admin@example.com` (SUPER_ADMIN tier),
  `arjun.rao@helloally.ai` (SUPER_DUPER_ADMIN tier),
  `multi-tenant-admin1@example.com` and `sarah.thompson@northwindbh.org`
  (MULTI_TENANT_ADMIN tier). Each also gets `PLATFORM_ADMIN` group
  membership plus the `admin_feature_toggles` rows their tier is entitled to
  (`admin-access.seeder.ts`, derived from `FEATURE_TOGGLES[].legacyGrants` in
  [`admin-feature-toggle.constants.ts`](src/authorization/constants/admin-feature-toggle.constants.ts)
  — the same registry the `CreatePlatformAdminRole` migration reads). Without
  this an admin logs in and finds Content Management, Analytics, Settings,
  AI Lab and ~20 other surfaces blocked, because `FeatureToggleGuard` fails
  closed on a missing toggle row.
- Other logins worth knowing: `org-admin@example.com` (ADMIN, tenant-scoped),
  `learner@example.com` (LEARNER+COUNSELOR — the one to log into
  Helpline/counselor-training as), `reviewer@example.com`
  (SIMULATION_REVIEWER)
- One scenario voice per active language (13 by default), 3 session events,
  10 scenarios (7 ACTIVE, 1 DRAFT, 1 COMING_SOON, 1 ARCHIVED), 4 scenario
  translations (hi-IN/mr-IN/ta-IN across 4 scenarios), 4 scenario_versions
  (draft/published/archived history on one scenario), 4 pathways, 3 cases
  (1 DRAFT), 3 tracks (1 ACTIVE with learner progress, 1 DRAFT, 1 ARCHIVED),
  10 badges (1 DRAFT) with 10 earned-badge rows across 5 learners
- 15 scenario sessions across every lifecycle state (ENDED, ACTIVE,
  ABANDONED, and an ENDED-but-force-exited-by-the-watchdog case), with
  transcripts, events, per-session metrics, and reviews spanning 3 of the 4
  tenants (including one HIDDEN review) — so scribe-reviewer, reviewer and
  admin dashboards all have real, varied data to read, not just the `ally`
  tenant's
- Scribe (helpline) data for `ally` and `riverside-wellness-center`: 7 calls
  across ENDED/SUCCESS, ENDED/FAILED and ACTIVE/PENDING states, plus a scribe
  review so both seeded SCRIBE_REVIEWER accounts have something to review in
  their own tenant
- Varied simulation-credit states (comfortably under, exact-boundary,
  blocked-though-under-limit, at-limit, and over-consumed) instead of one
  flat default for almost everyone
- Product roadmap: 6 opportunities covering every stage/type, with
  allocations, a comment, an interview note, and a saved view
- AI Lab: 2 variables/6 values/2 skills, plus a full Lab Run workflow — 2
  runs (1 COMPLETED+published, 1 FAILED), 2 evaluator accounts (one with a
  pending assignment), a published question set, submitted human answers,
  and an auto-evaluation — not just the config building blocks

#### Commands

```bash
# Seed the DB (idempotent — safe to re-run; existing rows are matched by unique key and skipped)
npm run seed

# Truncate all seeded tables, then re-seed from scratch
npm run seed:reset -- --confirm && npm run seed
```

`seed:reset` refuses to run without `--confirm` (or `SEED_RESET_CONFIRM=1`) and refuses entirely when `NODE_ENV=production`. It `TRUNCATE`s every table the seeders own — see the full, commented list (and what's deliberately excluded because a migration owns those rows instead) in [`reset.ts`](src/database/seeds/reset.ts). Note that almost nothing in this schema declares a real foreign key (verified: ~6 total, across every migration), so `CASCADE` does very little work here — a table missing from that list simply keeps its stale rows, and since `users` truncates with `RESTART IDENTITY`, those rows can silently re-attach to whoever inherits the recycled id on the next seed. Add any new table you seed to that list. Run against a dev DB only.

#### Login credentials

All seeded users share the same password and OTP:

- **Password**: `Password123!` (override with `SEED_DEFAULT_PASSWORD`)
- **OTP**: `1234` (override with `SEED_DEFAULT_OTP`; also needs matching entry in `TEST_ACCOUNTS` in `.env` for OTP login to work)

Role and feature-toggle lookups sit behind 30-minute Redis caches
(`user:roles:*`, `user:groups:*`, `admin:feature-toggles:*`). The seed writes
rows directly to Postgres and cannot bust them, so if you were already logged
in as a seeded admin before running `npm run seed`, flush those key patterns
(or wait up to 30 minutes, or just log out and back in) before the new
admin access appears.

#### Docker

Set `AUTO_SEED=true` in `.env` to run `npm run seed` once after migrations on container start (see [`docker-compose.yml`](docker-compose.yml)). Or run manually:

```bash
docker compose exec app npm run seed
```

## 📚 API Documentation

Once the application is running, access the interactive API documentation:

- **Swagger UI**: http://localhost:8001/api-docs

The API is versioned and accessible at:

- **v1**: `http://localhost:8001/api/v1/...`

### Authentication

Most endpoints require JWT authentication:

```
Authorization: Bearer <your-access-token>
```

The platform supports multiple authentication methods:

- **JWT** - Standard access/refresh token flow
- **OTP** - Email-based one-time password (v2)
- **Google OAuth** - Sign in with Google
- **Magic Link** - Email-based passwordless authentication
- **API Key** - `X-API-Key` header for service-to-service calls

### Key API Endpoints

| Endpoint                              | Description               |
| ------------------------------------- | ------------------------- |
| `POST /api/v1/auth/login`             | User login                |
| `POST /api/v1/auth/refresh`           | Refresh access token      |
| `POST /api/v1/auth/generate-otp`      | Generate OTP (v2)         |
| `POST /api/v1/auth/verify-otp`        | Verify OTP (v2)           |
| `POST /api/v1/auth/google`            | Google OAuth sign-in      |
| `POST /api/v1/auth/magic-link/verify` | Magic link verification   |
| `GET /api/v1/users/me`                | Get current user profile  |
| `GET /api/v1/health`                  | Health check endpoint     |
| `GET /api/v1/badges/me`               | Get current user's badges |
| `GET /api/v1/community`               | Community leaderboard     |
| `GET /api/v1/community/my-rank`       | Current user's rank       |
| `GET /api/analytics/*`                | Analytics dashboards      |
| `GET /api/tenant-analytics/*`         | Tenant-specific analytics |

**Prompts API (dashboard and sync):** See [docs/prompts-api.md](docs/prompts-api.md). Prompt folder (naming, meta JSON): [docs/prompts-folder.md](docs/prompts-folder.md).

## ✨ Key Features

### Scenario-Based Learning

- **Learning Pathways** - Compose ordered sets of scenarios into guided learning paths
- **Scenario Characters** - Define client personas (NPCs) for realistic simulations
- **Session Management** - Track learner progress through scenario sessions
- **Trigger Warnings** - Content warning system for sensitive scenario content
- **Reference Documents** - Associate supporting materials with scenarios or pathways
- **Voice Preview** - Text-to-speech preview for scenario voices (ElevenLabs, Deepgram, Sarvam, Google Cloud, Hume)

### AI & Audio Pipeline

- **LLM Integration** - Streaming responses via OpenAI for session summaries and analysis
- **Audio Processing** - Multipart S3 upload with presigned URLs; SQS-based async transcription pipeline with DLQ support
- **Conversational Guardrails** - Real-time boundary detection using binary classification, with multi-language support and automatic agent redirect
- **Session Reports** - AI-generated post-session analysis and scoring

### Real-Time Communication

- **WebSocket Gateways**
  - `/microphone-chat` - Live audio chat with message streaming
  - `/audio-ingest` - Cloud telephony integration
  - `/scenario-report` - Real-time scenario reporting
- **LiveKit Integration** - Voice/video room creation, participant lifecycle, agent dispatch, and webhook handling
- **Redis Message Broker** - Pub/sub for inter-service event delivery

### Review & Feedback

- **Scenario Session Review** - Threaded comments, emoji reactions, read status tracking, and badge awards
- **Scribe Session Review** - Transcript-based feedback with comment threads and reactions
- **Case Management** - Case creation, session tracking, and tenant-isolated case items

### Gamification & Community

- **Badge System** - Achievement badges with bulk and automatic awarding for milestones
- **Leaderboards** - Global and scenario-specific leaderboards with user ranking

### Prompt Management

- **Versioned Prompts** - Store and version system prompts used across AI services
- **Dashboard Sync** - Sync prompts from external sources
- **Per-Tenant Overrides** - Resolve tenant-specific prompt variants at runtime

### Multi-Tenant Platform

- **Tenant Isolation** - Cases, scenarios, dashboards, and analytics scoped per tenant
- **Role-Based Access Control** - Fine-grained permissions via groups and permission guards
- **Tenant Analytics** - Metabase integration with tenant-specific dashboard views

### Multi-Language Support

- **Translation Service** - OpenAI-powered translations for session events and guardrail content
- **Language Module** - Configurable language settings per tenant or scenario
- **Sarvam STT/TTS** - Indian language support

## 🧪 Testing & Code Quality

### Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run end-to-end tests
npm run test:e2e

# Run tests inside Docker
npm run test:docker
```

### Linting & Formatting

```bash
# Check for linting errors
npm run lint

# Auto-fix linting errors
npm run lint:fix

# Format code with Prettier
npm run format
```

## 🔍 Observability & Logging

### Logging

- **Winston** - Structured logging with multiple transports
- **CloudWatch** - HIPAA-compliant audit logging (optional)
- **Console Logging** - Configurable log levels

Configure log level via `LOG_LEVEL` environment variable:

| Level   | Description                       |
| ------- | --------------------------------- |
| `error` | Only errors                       |
| `warn`  | Warnings and errors (default)     |
| `info`  | Info, warnings, and errors        |
| `debug` | All logs including debug messages |

### Monitoring

- **Health Checks** - Built-in health check endpoints (`/api/health`)
- **Slack Alerts** - Exception and error notifications
- **CloudWatch Logs** - Audit trail for HIPAA compliance

## 🐛 Troubleshooting

### Database Connection Errors

```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Verify DB_HOST=postgres (for Docker) or localhost (for local) in docker.env
```

### Redis Connection Errors

```bash
# Check if Redis is running
docker-compose ps redis

# Test Redis connection
docker-compose exec redis redis-cli ping
```

### SQS Queue Errors

```bash
# Check LocalStack logs
docker-compose logs localstack

# Verify SQS queues are created
docker-compose logs sqs-setup

# Recreate queues if needed
docker-compose restart sqs-setup
```

### Port Already in Use

```bash
# Find process using port 8001
lsof -i :8001

# Kill the process or change PORT in docker.env
```

### Migration Errors

```bash
# Check migration status
npm run migration:show

# Ensure all required environment variables are set before retrying
npm run migration:run
```

### Debug Mode

```env
LOG_LEVEL=debug
NODE_ENV=development
```

## 👥 Contributing

For contributing guidelines, refer to `CONTRIBUTING.md`.

## 📞 Support

For issues, questions, or contributions:

- Open an issue on GitHub
- Contact the development team
- Check the API documentation at `/api-docs`

---
