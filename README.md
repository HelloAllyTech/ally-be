# 📞 Helpline Counseling Platform

A real-time mental health counseling platform built with NestJS that connects patients with counselors through voice communication. Now upgraded with AI-powered call transcription, live nudges, summaries, and analytics.

---

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

### Required Software

- **Node.js** (v18) - [Download](https://nodejs.org/)
- **npm** - Comes with Node.js
- **Docker** (v20.10 or higher) - [Download](https://www.docker.com/get-started)
- **Docker Compose** (v2.0 or higher) - Usually included with Docker Desktop
- **PostgreSQL** (v14 or higher) - For local development (optional, Docker recommended)
- **Redis** - For local development (optional, Docker recommended)

### Required Accounts & API Keys

- **Deepgram Account** - For speech-to-text transcription ([Sign up](https://deepgram.com/))
- **LiveKit Account** - For WebRTC audio/video calls ([Sign up](https://livekit.io/))
- **AI Service** - External AI service for summaries and analysis
- **AWS Account** (optional) - For S3, SQS, SES, CloudWatch (LocalStack can be used for local dev)
- **Metabase** (optional) - For analytics dashboards
- **Slack** (optional) - For exception alerts

---

## 🛠️ Technology Stack

| Component      | Tech Used                                |
| -------------- | ---------------------------------------- |
| Backend        | NestJS                                   |
| Database       | PostgreSQL                               |
| Caching        | Redis                                    |
| Real-time Comm | WebSocket (Socket.io)                    |
| Authentication | JWT, OTP                                 |
| Analytics      | PostgreSQL + Metabase                    |
| Observability  | Winston Logger + Slack alerts            |
| Documentation  | Swagger/OpenAPI                          |

---

## 📦 Environment Configuration

The application requires two environment files:

1. **`.env`** - For local development (when running without Docker)
2. **`docker.env`** - For Docker Compose setup

### Docker Environment (`docker.env`)

Create a `docker.env` file in the root directory. This file is used by all Docker services. Refer to `docker.env.example` for a template.

### Local Development Environment (`.env`)

Create a `.env` file in the root directory. This file is used by all Docker services. Refer to `.env.example` for a template.

**Note**: The `docker.env` file is used by Docker Compose services. The `.env` file is used when running the app directly with `npm run start:dev`.

---

## 🧪 Testing & Observability

### Testing

- ✅ **Jest** - Unit and integration testing framework
- ✅ **Test Coverage** - Coverage reports with `npm run test:cov`

### Logging

- 🔍 **Winston** - Structured logging with multiple transports
- 📊 **CloudWatch** - HIPAA-compliant audit logging (optional)
- 🖥️ **Console Logging** - Configurable log levels (error, warn, info, debug)

### Monitoring

- 📊 **Health Checks** - Built-in health check endpoints
- 🛠️ **Slack Alerts** - Exception and error notifications
- 🛠️ **Cloudwatch Logs**

### Log Levels

Configure log level via `LOG_LEVEL` environment variable:
- `error` - Only errors
- `warn` - Warnings and errors (default)
- `info` - Info, warnings, and errors
- `debug` - All logs including debug messages

---

## 🧭 Getting Started

### Docker Setup

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd ally-be
```

### Step 2: Configure Environment

1. Copy the sample environment file:
   ```bash
   cp docker.env.example docker.env
   cp .env.example .env
   ```

2. Edit `docker.env` and `.env` and fill in all required variables (see [Environment Configuration](#-environment-configuration) above)

### Step 3: Start Docker Services

Start PostgreSQL, Redis, LocalStack and SQS using Docker Compose:

```bash
docker-compose up
```
make sure the SQS URLs in your .env file match the ones shown in the Docker output.
Note: The app in Docker will not start automatically at the moment — it requires manual execution. The steps for running it manually are detailed in the following sections.


### Step 4: Run Database Migrations

```bash
npm run migration:run
```

The application will be available at:
- **Swagger Docs**: http://localhost:8001/api-docs
- **Health Check**: http://localhost:8001/api/health

### Alternative Setup (instead of using the app service in Docker Compose)

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Run Database Migrations

```bash
npm run migration:run
```

### Step 3: Start the Application

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

## 🗄️ Database Management

### Run Migrations

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

---

## 🌱 Database Seeding

Seed scripts are located in `src/database/seeds/` and can be run to populate the database with initial data.

### Running Seeds

```bash
# Run a specific seed by providing the file path
npm run seed -- src/database/seeds/<seed-file>.ts
```

### Available Seeds

| Seed File | Description | Dependencies |
|-----------|-------------|--------------|
| `admin_user.ts` | Creates an admin user with SUPER_ADMIN role | Requires `groups` table to have SUPER_ADMIN group |
| `user-tenant.ts` | Creates a tenant and sample users (Counselor, Learner, Admin) via API | Requires app to be running, admin user to exist |
| `scenarios-pathway.ts` | Creates sample scenarios and a learning pathway via API | Requires app to be running, admin user to exist |

### Seed Execution Order

For a fresh database, run seeds in this order:

```bash
# 1. Create admin user (direct DB access)
npm run seed -- src/database/seeds/admin_user.ts

# 2. Create tenant and users (requires app running)
npm run seed -- src/database/seeds/user-tenant.ts

# 3. Create scenarios and pathway (requires app running)
npm run seed -- src/database/seeds/scenarios-pathway.ts
```

---

## 🐛 Troubleshooting

### Common Issues

#### Database Connection Errors

```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Verify connection string in docker.env
# Ensure DB_HOST=postgres (for Docker) or localhost (for local)
```

#### Redis Connection Errors

```bash
# Check if Redis is running
docker-compose ps redis

# Test Redis connection
docker-compose exec redis redis-cli ping
```

#### SQS Queue Errors

```bash
# Check LocalStack logs
docker-compose logs localstack

# Verify SQS queues are created
docker-compose logs sqs-setup

# Recreate queues if needed
docker-compose restart sqs-setup
```

#### Port Already in Use

```bash
# Find process using port 8001
lsof -i :8001

# Kill the process or change PORT in docker.env
```

#### Migration Errors

```bash
# Check migration status
npm run migration:show

# If migrations fail, check database connection
# Ensure all required environment variables are set
```

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=debug
NODE_ENV=development
```

---

## 🧹 Code Quality

### Linting

```bash
# Check for linting errors
npm run lint

# Auto-fix linting errors
npm run lint:fix
```

### Code Formatting

```bash
# Format code with Prettier
npm run format
```

### Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

```

## 📚 API Documentation

Once the application is running, access the interactive API documentation:

- **Swagger UI**: http://localhost:8001/api-docs

The API is versioned and accessible at:
- **v1**: `http://localhost:8001/api/v1/...`

### Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-access-token>
```

### Example API Endpoints

- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/refresh` - Refresh access token
- `GET /api/v1/users/me` - Get current user
- `GET /api/v1/health` - Health check endpoint

---

## 👥 Contributing

For contributing guidelines, refer to `CONTRIBUTING.md` file

---

## 📞 Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Contact the development team
- Check the API documentation at `/api-docs`

---
