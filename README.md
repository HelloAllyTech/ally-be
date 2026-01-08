# 📞 Ally - Mental Health Counseling Platform

**Ally** is an open-source, real-time mental health counseling platform that connects patients with counselors through secure voice communication. Built with modern technologies, it features AI-powered call transcription, live nudges, summaries, and comprehensive analytics.

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-v9+-red.svg)](https://nestjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg)](https://www.docker.com/)

</div>

---

## 📖 Table of Contents

- [✨ Features](#-features)
- [🛠️ Technology Stack](#️-technology-stack)
- [📋 Prerequisites](#-prerequisites)
- [📦 Environment Configuration](#-environment-configuration)
- [� Google Cloud Translation Setup](#-google-cloud-translation-setup)
- [�🚀 Quick Start Guide](#-quick-start-guide)
  - [Option 1: Docker Setup (Recommended)](#option-1-docker-setup-recommended-for-beginners-)
  - [Option 2: Local Development](#option-2-local-development-setup)
  - [Option 3: Production Deployment](#option-3-production-deployment)
- [🗄️ Database Management](#️-database-management)
- [🌱 Database Seeding](#-database-seeding)
- [📊 Working with Data](#-working-with-data)
- [🐛 Troubleshooting](#-troubleshooting)
- [📝 Development Guide](#-development-guide)
- [🧪 Testing & Observability](#-testing--observability)
- [📚 API Documentation](#-api-documentation)
- [📦 Project Structure](#-project-structure)
- [🔧 npm Scripts](#-npm-scripts)
- [👥 Contributing](#-contributing)
- [🤝 Community & Support](#-community--support)
- [📄 License](#-license)

---

## ✨ Features

- 🎤 **Real-time Voice Calls** - Secure WebRTC-based audio communication
- 🤖 **AI Transcription** - Automatic call transcription and analysis
- 📊 **Live Nudges & Summaries** - Real-time counseling insights
- 📈 **Advanced Analytics** - Comprehensive call and session analytics
- 🔐 **Secure Authentication** - JWT-based authentication with OTP support
- 📱 **Multi-tenant Support** - Isolated environments for multiple organizations
- 🔔 **Real-time Notifications** - WebSocket-based instant updates

---

## 🛠️ Technology Stack

| Layer             | Technology            | Purpose                    |
| ----------------- | --------------------- | -------------------------- |
| **Backend**       | NestJS                | Scalable Node.js framework |
| **Database**      | PostgreSQL 14+        | Relational data storage    |
| **Cache**         | Redis                 | Session & data caching     |
| **Real-time**     | WebSocket (Socket.io) | Live communication         |
| **Voice**         | WebRTC + LiveKit      | Audio/video infrastructure |
| **Transcription** | Deepgram API          | Speech-to-text conversion  |
| **Queue**         | AWS SQS / LocalStack  | Async job processing       |
| **Analytics**     | PostgreSQL + Metabase | Data visualization         |
| **Logging**       | Winston + CloudWatch  | Structured logging         |
| **Testing**       | Jest                  | Unit & integration testing |

---

## � Prerequisites

### System Requirements

Before you begin, make sure your system meets these requirements:

#### Option 1: Docker Setup (Recommended for Beginners)

- **Docker** v20.10+ - [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose** v2.0+ - Usually included with Docker Desktop
- **Git** - [Install Git](https://git-scm.com/downloads)
- **Node.js** v18+ - [Install Node.js](https://nodejs.org/) (needed for CLI tools)

#### Option 2: Local Development Setup

- **Node.js** v18+ - [Install Node.js](https://nodejs.org/)
- **PostgreSQL** v14+ - [Install PostgreSQL](https://www.postgresql.org/download/)
- **Redis** - [Install Redis](https://redis.io/download)
- **Git** - [Install Git](https://git-scm.com/downloads)

### Third-Party Services (Required)

You'll need accounts and API credentials for these services. Free tiers are usually available:

| Service        | Purpose                           | Signup Link                           | Cost                |
| -------------- | --------------------------------- | ------------------------------------- | ------------------- |
| **Deepgram**   | Speech-to-text transcription      | [deepgram.com](https://deepgram.com/) | Free tier available |
| **LiveKit**    | WebRTC audio/video infrastructure | [livekit.io](https://livekit.io/)     | Free tier available |
| **AI Service** | Call summaries & analysis         | Provider-specific                     | -                   |

### Third-Party Services (Optional)

| Service             | Purpose                  | Cost                      |
| ------------------- | ------------------------ | ------------------------- |
| **AWS Account**     | S3, SQS, SES, CloudWatch | Free tier + pay-as-you-go |
| **Slack Workspace** | Error notifications      | Free                      |
| **Metabase**        | Analytics dashboards     | Open source / Cloud       |

---

## 📦 Environment Configuration

The application uses environment variables to manage configuration across different environments.

### Available Environment Files

1. **`docker.env`** - Configuration for Docker Compose services
2. **`.env`** - Configuration for local development (npm run start:dev)

### Getting Started with Environment Variables

1. **Copy the example files:**

   ```bash
   cp docker.env.example docker.env
   cp .env.example .env
   ```

2. **Edit the files** with your actual values:

   - Open `docker.env` for Docker setup
   - Open `.env` for local development

3. **Key variables to configure:**

   ```env
   # Database
   DB_HOST=postgres          # localhost for local dev
   DB_PORT=5432
   DB_USERNAME=your_username
   DB_PASSWORD=your_password
   DB_DATABASE=ally_db

   # Redis
   REDIS_URL=redis://redis:6379   # redis://localhost:6379 for local dev

   # API Keys
   DEEPGRAM_API_KEY=your_deepgram_key
   LIVEKIT_API_KEY=your_livekit_key
   LIVEKIT_API_SECRET=your_livekit_secret

   # JWT
   JWT_SECRET=your_jwt_secret_key
   JWT_EXPIRY=1d

   # Server
   NODE_ENV=development
   PORT=8001
   LOG_LEVEL=info

   # Google Cloud Translation Service
   GOOGLE_APPLICATION_CREDENTIALS=gcloud/application_default_credentials.json
   PROJECT_ID=your_google_cloud_project_id

   # Google OAuth
   GOOGLE_WEB_CLIENT_ID=your_google_web_client_id
   GOOGLE_IOS_CLIENT_ID=your_google_ios_client_id
   GOOGLE_ANDROID_CLIENT_ID=your_google_android_client_id
   ```

**Note**: The `docker.env` file is used by Docker Compose. The `.env` file is used when running the app directly with `npm run start:dev`.

---

## 🔐 Google Cloud Translation Setup

The application uses Google Cloud Translation for real-time call translations and transcription support.

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your **Project ID** - you'll need this for `PROJECT_ID` env variable

### Step 2: Enable Translation API

1. In Google Cloud Console, go to **APIs & Services** > **Library**
2. Search for "Cloud Translation API"
3. Click on it and press **Enable**

### Step 3: Create a Service Account

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **Service Account**
3. Fill in the service account name (e.g., "ally-translation")
4. Click **Create and Continue**
5. Grant these roles:
   - **Cloud Translation User** - For translation operations
6. Click **Continue** > **Done**

### Step 4: Generate and Download Service Account Key

1. In the Service Accounts list, click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Choose **JSON** format
5. Click **Create** - A JSON file will download automatically

### Step 5: Add Credentials to Your Project

**For Docker Setup:**

```bash
# Copy the downloaded JSON file to the gcloud directory
cp ~/Downloads/your-service-account-key.json gcloud/application_default_credentials.json
```

**For Local Development:**

```bash
# Copy the downloaded JSON file to the gcloud directory
cp ~/Downloads/your-service-account-key.json gcloud/application_default_credentials.json
```

### Step 6: Update Environment Variables

Add to your `.env` or `docker.env`:

```env
GOOGLE_APPLICATION_CREDENTIALS=gcloud/application_default_credentials.json
PROJECT_ID=your_google_cloud_project_id
```

Replace `your_google_cloud_project_id` with the Project ID from Step 1.

### Verify Setup

Once you start the app, test if translation is working:

```bash
curl http://localhost:8001/api/health
# Look for "translation" service status
```

The health check should show the translation service as "UP" if credentials are correct.

### Troubleshooting Google Cloud Translation

**Error: "Could not load the default credentials"**

- Ensure `gcloud/application_default_credentials.json` exists
- Verify the path in `GOOGLE_APPLICATION_CREDENTIALS` is correct
- Check file permissions: `ls -la gcloud/application_default_credentials.json`

**Error: "Permission denied" or "Not authorized"**

- Verify the service account has "Cloud Translation User" role
- Re-download the service account key and try again

**Translation endpoints return 403 errors**

- Check that Translation API is enabled in Google Cloud Console
- Verify the service account key file is valid JSON

---

## 🚀 Quick Start Guide

Choose one of the setup options below based on your preference.

### Option 1: Docker Setup (Recommended for Beginners) ⭐

This is the easiest way to get started. Docker handles all infrastructure setup.

#### Step 1: Clone the Repository

```bash
git clone https://github.com/HelloAllyTech/ally-be.git
cd ally-be
```

#### Step 2: Set Up Environment Variables

```bash
# Copy the example environment files
cp docker.env.example docker.env
cp .env.example .env
```

Then edit `docker.env` and add your API keys:

- `DEEPGRAM_API_KEY` - From [Deepgram Console](https://console.deepgram.com/)
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` - From [LiveKit Console](https://cloud.livekit.io/)

#### Step 3: Start Docker Services

```bash
# Start all services (PostgreSQL, Redis, LocalStack, SQS)
docker-compose up
```

This will start:

- PostgreSQL on port 5477
- Redis on port 6379
- LocalStack with SQS support

**Note**: The application service won't start automatically. Continue to Step 4.

#### Step 4: Set Up the Application (in a new terminal)

```bash
# Install dependencies
npm install

# Run database migrations
npm run migration:run

# Start the application
npm run start:dev
```

#### Step 5: Verify Installation

Open your browser and check:

- **API Documentation**: http://localhost:8001/api-docs
- **Health Check**: http://localhost:8001/api/health

✅ You should see the Swagger UI. The platform is ready!

---

### Option 2: Local Development Setup

This option is for developers who want to run everything locally without Docker.

#### Step 1: Clone the Repository

```bash
git clone https://github.com/HelloAllyTech/ally-be.git
cd ally-be
```

#### Step 2: Install Dependencies

```bash
npm install
```

#### Step 3: Set Up PostgreSQL

**macOS** (using Homebrew):

```bash
brew install postgresql
brew services start postgresql
```

**Linux** (Ubuntu/Debian):

```bash
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows**: Download from [postgresql.org](https://www.postgresql.org/download/windows/)

Create a database:

```bash
createdb ally_db
```

#### Step 4: Set Up Redis

**macOS** (using Homebrew):

```bash
brew install redis
brew services start redis
```

**Linux** (Ubuntu/Debian):

```bash
sudo apt-get install redis-server
sudo systemctl start redis-server
```

**Windows**: Download from [microsoftarchive/redis](https://github.com/microsoftarchive/redis/releases)

#### Step 5: Configure Environment

```bash
# Copy example file
cp .env.example .env
```

Edit `.env` and update:

```env
# Database (local PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=ally_db

# Redis (local)
REDIS_URL=redis://localhost:6379

# API Keys
DEEPGRAM_API_KEY=your_key
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
```

#### Step 6: Run Migrations & Start App

```bash
# Run database migrations
npm run migration:run

# Start the development server
npm run start:dev
```

#### Step 7: Verify Installation

- **API Docs**: http://localhost:8001/api-docs
- **Health Check**: http://localhost:8001/api/health

---

### Option 3: Production Deployment

For production environments:

```bash
# Build the application
npm run build

# Start in production mode
npm run start:prod
```

Ensure all environment variables are properly configured for your production environment.

## 🗄️ Database Management

### Understanding Migrations

Migrations are version-controlled database schema changes. They ensure your database stays in sync across environments.

### Running Migrations

```bash
# Run all pending migrations
npm run migration:run

# Show migration status
npm run migration:show

# Revert the last migration
npm run migration:revert
```

### Creating New Migrations

When you modify entities in your code:

```bash
# Generate migration from entity changes
npm run migration:generate --name=AddNewColumn

# Create an empty migration file
npm run migration:create --name=AddNewColumn
```

### Database Connection Details

| Environment | Host        | Port | Default User |
| ----------- | ----------- | ---- | ------------ |
| Docker      | `postgres`  | 5432 | postgres     |
| Local Dev   | `localhost` | 5432 | postgres     |

Connection values are read from your `.env` or `docker.env` file:

- `DB_HOST`
- `DB_PORT`
- `DB_USERNAME`
- `DB_PASSWORD`
- `DB_DATABASE`

---

## 🌱 Database Seeding

Seeding populates your database with initial data (users, roles, test data, etc.). The seeding system automatically executes seeds in the correct dependency order and provides visibility into the process. Seeds are located in `src/database/seeds/`.

### ⚡ Quick Start - Seed Everything

The fastest way to get a fully seeded database with test data:

```bash
# Ensure database migrations are run first
npm run migration:run

# Run all seeds in the correct order (one-liner)
npm run seed:all
```

This command automatically:

1. Creates the admin user
2. Creates voices and events
3. Creates tenant, organizations, and test users
4. Creates learning scenarios and pathways

After completion, you can immediately log in with any test user. ✅

### 📋 Test Credentials

After running `npm run seed:all`, you can log in with these credentials but make sure you have added them .env as TEST_ACCOUNTS:

| User Type      | Email                 | OTP  | Role             |
| -------------- | --------------------- | ---- | ---------------- |
| **Admin**      | admin@example.com     | 1234 | SUPER_ADMIN      |
| **Counselor**  | counselor@example.com | 1234 | COUNSELOR        |
| **Learner**    | learner@example.com   | 1234 | LEARNER          |
| **Org Admin**  | orgadmin@example.com  | 1234 | ORG_ADMIN        |
| **Multi-Role** | multirole@example.com | 1234 | COUNSELOR, ADMIN |

### 🎯 Seed Commands Reference

#### Run All Seeds (Orchestrated)

```bash
npm run seed:all        # Runs all seeds with orchestrator
npm run seed:orchestrate  # Same as above
```

#### Run Individual Seed Scripts

```bash
npm run seed:admin      # Create admin user only
npm run seed:voices     # Create voices and events only
npm run seed:users      # Create users and tenant only
npm run seed:scenarios  # Create scenarios and pathways only
```

#### Run Custom Seeds

```bash
# Run specific seed file
npm run seed -- src/database/seeds/admin_user.ts
npm run seed -- src/database/seeds/seed-voices-and-events.ts
npm run seed -- src/database/seeds/user-tenant.ts
npm run seed -- src/database/seeds/scenarios-pathway.ts
```

### 📚 Available Seeds

| Seed File                     | Purpose                                          | Dependencies              | App Running? |
| ----------------------------- | ------------------------------------------------ | ------------------------- | ------------ |
| **admin_user.ts**             | Create SUPER_ADMIN user                          | None                      | ❌ No        |
| **seed-voices-and-events.ts** | Create voices, language support, and event types | admin_user.ts             | ❌ No        |
| **user-tenant.ts**            | Create organizations, tenant, and sample users   | Voices & Events, Admin    | ✅ Yes       |
| **scenarios-pathway.ts**      | Create learning scenarios and learning pathways  | All previous seeds, Users | ✅ Yes       |

### 🔄 Complete Seeding Workflow

#### Option 1: Automated (Recommended)

This is the easiest approach - seeds run in the correct order automatically:

```bash
# 1. Ensure clean database with migrations
npm run migration:run

# 2. Run all seeds at once (takes ~30 seconds)
npm run seed:all

# 3. Start the app in a new terminal
npm run start:dev

# 4. Login with test credentials from the table above
```

#### Option 2: Manual Control

If you need more control over the process:

```bash
# Terminal 1: Run the first database-level seeds
npm run seed:admin       # Creates admin user
npm run seed:voices      # Creates voices and events

# Terminal 2: Start the app (required for remaining seeds)
npm run start:dev

# Terminal 3: Run application-level seeds
npm run seed:users       # Creates users and tenant
npm run seed:scenarios   # Creates scenarios and pathways
```

### 🔧 Seeding Configuration

You can customize seed behavior with environment variables in your `.env` file:

```env
# Seed Configuration
SEED_DEBUG=false              # Set to 'true' for detailed logging
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=password123
SEED_TENANT_NAME=Test Organization
SEED_SCENARIO_COUNT=2         # Number of scenarios to create

# Database Selection for Seeding
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=ally_db           # Change to test database for testing
```

See `src/database/seeds/seed-config.ts` for all 20+ configurable options.

### 📊 Seed Output Example

When you run seeds, you'll see output like this:

```
🌱 Ally Backend - Database Seeding System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[INFO] Starting seed orchestrator...
[INFO] Running 4 seed tasks in sequence

✅ Task 1/4: Admin User Seed [COMPLETED in 2s]
✅ Task 2/4: Voices & Events [COMPLETED in 5s]
✅ Task 3/4: Users & Tenant [COMPLETED in 8s]
✅ Task 4/4: Scenarios & Pathways [COMPLETED in 12s]

🎉 All seeds completed successfully!
⏱️  Total time: 27 seconds

📋 Seed Summary:
  • Admin Users: 1
  • Test Users: 5
  • Organizations: 1
  • Voices: 8+
  • Scenarios: 2
  • Learning Paths: 4+
```

### 🧪 Testing with Separate Database

To test seeding without affecting your main database:

```bash
# 1. Create a test database
createdb ally_test

# 2. Update .env
DB_DATABASE=ally_test

# 3. Run migrations on test database
npm run migration:run

# 4. Seed the test database
npm run seed:all

# 5. Switch back to main database when done
# Edit .env: DB_DATABASE=ally_db
```

### 🐛 Troubleshooting Seeds

#### Error: "Database connection failed"

Ensure migrations are run before seeding:

```bash
npm run migration:run
npm run seed:all
```

#### Error: "Admin user already exists"

Drop and recreate the database:

```bash
dropdb ally_db
createdb ally_db
npm run migration:run
npm run seed:all
```

#### Seeds Running Slowly

- Ensure app is running on port 8001 when using `npm run seed:users` and `npm run seed:scenarios`
- Check network/database connection performance
- Review logs with `SEED_DEBUG=true` for detailed timing

#### Seed Won't Complete

- Check app logs in the terminal running `npm run start:dev`
- Verify all previous seeds completed successfully
- Review `src/database/seeds/seed-logger.ts` output for specific errors

### 📖 Detailed Documentation

For advanced seeding topics and detailed explanations:

- **[SEED_GUIDE.md](./SEED_GUIDE.md)** - Complete seeding reference
- **[SEED_VERIFICATION_CHECKLIST.md](./SEED_VERIFICATION_CHECKLIST.md)** - Verify seeds worked correctly
- **[SEED_QUICK_REFERENCE.md](./SEED_QUICK_REFERENCE.md)** - Quick command lookup
- **[CHANGELOG_SEEDS.md](./CHANGELOG_SEEDS.md)** - Recent seed changes and improvements

See the `docs/` folder for more comprehensive documentation.

---

## 📊 Working with Data

### Access Database Directly

**With Docker:**

```bash
docker-compose exec postgres psql -U postgres -d ally_db
```

**Local PostgreSQL:**

```bash
psql -U postgres -d ally_db
```

Common SQL commands:

```sql
\dt                    -- List all tables
\d table_name          -- Describe table
SELECT * FROM users;   -- View users
```

---

## 🐛 Troubleshooting

Having issues? Here are solutions to common problems.

### Docker Setup Issues

#### Docker Services Won't Start

```bash
# Check if Docker daemon is running
docker --version

# View detailed logs
docker-compose logs

# Restart all services
docker-compose down
docker-compose up
```

#### PostgreSQL Connection Issues

**Symptom**: `ECONNREFUSED` errors connecting to database

```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# View PostgreSQL logs for errors
docker-compose logs postgres

# Verify connection string in docker.env matches Docker config
# Should be: DB_HOST=postgres (not localhost)
```

#### Redis Connection Issues

**Symptom**: `ECONNREFUSED` on Redis connection

```bash
# Check Redis status
docker-compose ps redis

# Test Redis connection
docker-compose exec redis redis-cli ping
# Should return: PONG

# View logs
docker-compose logs redis
```

#### SQS/LocalStack Issues

**Symptom**: Queue creation fails or messages not being processed

```bash
# Check LocalStack logs
docker-compose logs localstack

# Verify queues are created
docker-compose logs sqs-setup

# Recreate queue setup
docker-compose restart sqs-setup
```

### Local Development Issues

#### PostgreSQL Won't Start (macOS)

```bash
# If using Homebrew
brew services start postgresql

# Or manually
postgres -D /usr/local/var/postgres
```

#### Redis Won't Start (macOS)

```bash
# If using Homebrew
brew services start redis

# Or manually
redis-server
```

#### Port Already in Use

**Symptom**: `Error: listen EADDRINUSE: address already in use :::8001`

```bash
# Find what's using the port
lsof -i :8001

# Kill the process (replace PID)
kill -9 <PID>

# Or change the port in .env
PORT=8002
```

### Application Issues

#### Migration Failures

**Symptom**: `QueryFailedError` when running migrations

```bash
# Check migration status
npm run migration:show

# Verify all environment variables are set
cat .env | grep DB_

# Check database connectivity
npm run migration:run
```

**Solution**: Make sure:

- Database is running and accessible
- All `DB_*` variables are correct
- Database user has proper permissions

#### Seed Failures

**Symptom**: Seed script fails or gets stuck

```bash
# Check if app is running
curl http://localhost:8001/api/health

# View app logs
npm run start:dev  # Look at console output

# Ensure admin user exists before running other seeds
npm run seed -- src/database/seeds/admin_user.ts
```

#### API Returns 503 Service Unavailable

**Symptom**: API endpoint returns error about services

```bash
# Check health endpoint
curl http://localhost:8001/api/health

# Verify all required services are running:
docker-compose ps          # For Docker setup
# Check: postgres, redis, localstack

# Verify API keys are set
echo $DEEPGRAM_API_KEY
echo $LIVEKIT_API_KEY
```

### Enable Debug Logging

Add these to your `.env` or `docker.env`:

```env
LOG_LEVEL=debug
NODE_ENV=development
```

Then restart the app:

```bash
npm run start:dev
```

### Still Having Issues?

1. **Check the logs**: Review both app logs and Docker logs
2. **Verify environment**: Ensure all required env vars are set
3. **Database state**: Try reseeding from scratch
4. **Clean rebuild**: Run `npm install` again
5. **Open an issue**: Check [GitHub Issues](https://github.com/HelloAllyTech/ally-be/issues)

---

## 📝 Development Guide

### Code Quality

#### Linting

Check and fix code style issues:

```bash
# Show linting errors
npm run lint

# Auto-fix linting errors
npm run lint:fix
```

#### Code Formatting

Automatically format your code:

```bash
# Format all code with Prettier
npm run format
```

### Testing

Write and run tests to ensure code quality:

```bash
# Run all tests once
npm run test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:cov
```

---

## 🧪 Testing & Observability

### Unit & Integration Testing

Write and run tests to ensure code quality:

```bash
# Run all tests once
npm run test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:cov
```

### Testing Best Practices

1. **Write tests alongside code** - Maintain >80% coverage
2. **Use descriptive test names** - Clearly describe what is being tested
3. **Test edge cases** - Include boundary conditions and error scenarios
4. **Mock external dependencies** - Use Jest mocks for APIs, databases, etc.
5. **Test in isolation** - Each test should be independent

### Debugging Tests

```bash
# Run tests with verbose output
npm run test -- --verbose

# Run specific test file
npm run test -- auth.service.spec.ts

# Run tests matching a pattern
npm run test -- --testNamePattern="Auth"

# Debug tests in Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Application Observability

Monitor your application in production:

#### Logging

The application uses structured logging to track events and errors:

```bash
# Control log level via environment variable
LOG_LEVEL=debug npm run start:dev    # Verbose logging
LOG_LEVEL=info npm run start:dev     # Standard logging
LOG_LEVEL=error npm run start:dev    # Errors only
```

**Log Levels** (from most to least verbose):

- `debug` - Detailed debugging information
- `info` - General informational messages
- `warn` - Warning messages
- `error` - Error messages

#### Application Monitoring

Monitor key metrics:

- **API Response Times** - Track endpoint performance
- **Database Queries** - Monitor query execution
- **Error Rates** - Track application errors
- **Redis Cache** - Monitor cache hit rates
- **WebSocket Connections** - Monitor real-time connections

#### Health Checks

Check application health:

```bash
# Health check endpoint
curl http://localhost:8001/api/v1/health
```

#### Metrics & Analytics

View analytics dashboard (if Metabase is configured):

```
http://localhost:3000  # Default Metabase port
```

### Common Testing Patterns

#### Testing Services

```typescript
describe('UserService', () => {
  let service: UserService;
  let repository: UserRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [UserService, { provide: UserRepository, useValue: {} }],
    }).compile();

    service = module.get<UserService>(UserService);
    repository = module.get<UserRepository>(UserRepository);
  });

  it('should create a user', async () => {
    const user = { email: 'test@example.com' };
    jest.spyOn(repository, 'save').mockResolvedValue(user);

    const result = await service.create(user);
    expect(result).toEqual(user);
  });
});
```

---

## 📚 API Documentation

### Interactive API Documentation

Once the application is running, you can explore the API interactively:

**Swagger UI**: http://localhost:8001/api-docs

### API Versioning

The API uses versioning to maintain backward compatibility:

```
Base URL: http://localhost:8001/api/v1
```

### Authentication

Most endpoints require JWT authentication. Include your access token:

```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  http://localhost:8001/api/v1/users/me
```

### Common Endpoints

| Endpoint               | Method | Description             |
| ---------------------- | ------ | ----------------------- |
| `/api/v1/auth/login`   | POST   | Login with credentials  |
| `/api/v1/auth/refresh` | POST   | Refresh access token    |
| `/api/v1/users/me`     | GET    | Get current user info   |
| `/api/v1/health`       | GET    | Check API health status |

### Getting Your Access Token

1. **Login** to get tokens:

   ```bash
   curl -X POST http://localhost:8001/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@example.com","password":"password"}'
   ```

2. **Use the token** in subsequent requests:
   ```bash
   curl -H "Authorization: Bearer {access_token}" \
     http://localhost:8001/api/v1/users/me
   ```

---

## 📦 Project Structure

Understanding the codebase organization:

```
src/
├── app.module.ts          # Root module
├── main.ts               # Application entry point
├── ai/                   # AI/ML features
├── auth/                 # Authentication
├── authorization/        # Authorization & permissions
├── chat/                 # Chat functionality
├── audio/                # Audio processing
├── audio-ingest/         # Audio ingestion pipeline
├── database/             # Database & migrations
├── config/               # Configuration management
└── ...                   # Other feature modules
```

Each module follows NestJS structure:

- `*.module.ts` - Module definition
- `*.service.ts` - Business logic
- `*.controller.ts` - HTTP routes
- `dto/` - Data transfer objects
- `entity/` - Database entities
- `repository/` - Data access layer

---

## 🔧 npm Scripts

### Development

| Command              | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `npm run start:dev`  | Start development server with hot reload |
| `npm run build`      | Compile TypeScript to JavaScript         |
| `npm run start:prod` | Start production server                  |

### Database

| Command                      | Purpose                          |
| ---------------------------- | -------------------------------- |
| `npm run migration:run`      | Run pending migrations           |
| `npm run migration:revert`   | Undo last migration              |
| `npm run migration:show`     | Show migration status            |
| `npm run migration:generate` | Generate migration from entities |
| `npm run seed -- <path>`     | Run a specific seed script       |
| `npm run seed:all`           | Run all seeds in order           |

### Code Quality

| Command              | Purpose                    |
| -------------------- | -------------------------- |
| `npm run lint`       | Check code style           |
| `npm run lint:fix`   | Auto-fix code style issues |
| `npm run format`     | Format code with Prettier  |
| `npm run test`       | Run tests once             |
| `npm run test:watch` | Run tests in watch mode    |
| `npm run test:cov`   | Run tests with coverage    |

# Format code with Prettier

npm run format

````

### Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

````

---

## � Contributing

We welcome contributions from the community! Whether it's bug reports, feature requests, or code contributions, your help is appreciated.

### Getting Started with Contributing

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Create a feature branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes** and commit them
5. **Push to your fork**: `git push origin feature/your-feature-name`
6. **Open a Pull Request** with a clear description of changes

### Before Contributing

Please read our [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Code of conduct
- Coding standards
- Testing requirements
- Commit message format
- Pull request process

### Development Setup for Contributors

Follow the **Option 2: Local Development Setup** guide above to get a development environment running.

---

## 🤝 Community & Support

### Getting Help

- **Bug Report**: [Open an Issue](https://github.com/HelloAllyTech/ally-be/issues) with `bug` label
- **Feature Request**: [Open an Issue](https://github.com/HelloAllyTech/ally-be/issues) with `enhancement` label
- **General Questions**: Check [Discussions](https://github.com/HelloAllyTech/ally-be/discussions)
- **Documentation**: Read this README and API docs at `/api-docs`

### Resources

- **API Documentation**: http://localhost:8001/api-docs (when running)
- **Contributing Guide**: [CONTRIBUTING.md](./CONTRIBUTING.md)
- **GitHub Issues**: [Report bugs or request features](https://github.com/HelloAllyTech/ally-be/issues)

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

## 🙌 Acknowledgments

Built with ❤️ by the Ally community.

Thank you to all our contributors who have helped make this project better!
