# 📞 Helpline Counseling Platform

A real-time mental health counseling platform built with NestJS that connects patients with counselors through voice communication. Now upgraded with AI-powered call transcription, live nudges, summaries, and analytics.

---

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

### Required Software

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **npm** (v9 or higher) - Comes with Node.js
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

### System Requirements

- **RAM**: Minimum 4GB, Recommended 8GB+
- **Disk Space**: At least 2GB free
- **OS**: macOS, Linux, or Windows (with WSL2 for Docker)

---

## 🚀 Features

### Core Features
- 💬 **Real-time Chat** - WebSocket-based messaging using Socket.io
- 📞 **Voice/Video Calls** - WebRTC peer-to-peer communication via LiveKit
- 🔁 **Third-party Call Integration** - Support for Exotel, Ozonetel, and other telephony providers
- 🧠 **AI-Powered Transcription** - Real-time speech-to-text using Deepgram
- 💡 **Live Feedback messages** - Real-time AI-powered suggestions during calls
- 📋 **Post-Call Summaries** - Automated conversation summaries and analysis
- 📊 **Analytics** - Call and chat analytics with Metabase integration
- 🧾 **Message History** - Paginated message history with search
- 🧠 **Sentiment Analysis** - Optional sentiment tracking and analysis

### Platform Features
- 🛡️ **Authentication** - JWT-based auth with OTP support (Email/SMS)
- 👥 **Multi-tenant Support** - Tenant isolation and management
- 🔐 **Authorization** - Role-based access control (RBAC)
- 🗃️ **Redis Caching** - Session and data caching
- 📁 **File Management** - Audio file storage and reference document management
- 🎓 **Learning Module** - Training scenarios and reference materials
- 📍 **Place Management** - Location-based features
- ⚙️ **Settings Management** - Configurable system settings
- 📝 **Session Events** - Event tracking and logging
- 🔔 **Notifications** - Event-driven notification system

### Infrastructure
- 🐳 **Docker Support** - Full Docker Compose setup for local development
- 📄 **API Documentation** - Swagger/OpenAPI at `/api-docs`
- 🏥 **Health Checks** - Application health monitoring
- 📊 **CloudWatch Integration** - HIPAA-compliant audit logging
- 🛠️ **Exception Handling** - Custom exception filters with Slack alerts
- 🔄 **Message Broker** - SQS-based async message processing

---

---

## 🛠️ Technology Stack

| Component      | Tech Used                                |
| -------------- | ---------------------------------------- |
| Backend        | NestJS                                   |
| Database       | PostgreSQL                               |
| Caching        | Redis                                    |
| Real-time Comm | WebSocket (Socket.io)                    |
| AI Engine      | LLM / internal models                    |
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
- ✅ **Supertest** - HTTP endpoint testing
- ✅ **Test Coverage** - Coverage reports with `npm run test:cov`
- ✅ **E2E Tests** - End-to-end testing support

### Logging

- 🔍 **Winston** - Structured logging with multiple transports
- 📊 **CloudWatch** - HIPAA-compliant audit logging (optional)
- 🖥️ **Console Logging** - Configurable log levels (error, warn, info, debug)

### Monitoring

- 📊 **Health Checks** - Built-in health check endpoints
- 📈 **Metabase Dashboards** - Analytics and insights
- 🛠️ **Slack Alerts** - Exception and error notifications
- 📉 **Custom Metrics** - Application-specific metrics

### Log Levels

Configure log level via `LOG_LEVEL` environment variable:
- `error` - Only errors
- `warn` - Warnings and errors (default)
- `info` - Info, warnings, and errors
- `debug` - All logs including debug messages

---

## 🧭 Getting Started

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd ally-be
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment

1. Copy the sample environment file:
   ```bash
   cp docker.env.example docker.env
   cp .env.example .env
   ```

2. Edit `docker.env` and `.env` and fill in all required variables (see [Environment Configuration](#-environment-configuration) above)

### Step 4: Start Docker Services

Start PostgreSQL, Redis, LocalStack and SQS using Docker Compose:

```bash
docker-compose up
```
make sure the SQS URLs in your .env file match the ones shown in the Docker output.
Note: The app in Docker will not start automatically at the moment — it requires manual execution. The steps for running it manually are detailed in the following sections.


### Step 5: Run Database Migrations

```bash
npm run migration:run
```

### Step 6: Start the Application

#### Development Mode (with hot-reload)

```bash
npm run start:dev
```

The application will be available at:
- **API**: http://localhost:8000/api
- **Swagger Docs**: http://localhost:8000/api-docs
- **Health Check**: http://localhost:8000/api/health

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

## 📊 Analytics with Metabase

### Data Collection

The platform collects and stores the following metadata in PostgreSQL:

- **Call Metrics**: Duration, source (WebRTC/Provider), timestamps
- **Transcription Data**: Full transcripts, speaker identification
- **AI Insights**: Keywords, topics, sentiment scores
- **Nudge Analytics**: Nudges triggered, effectiveness
- **User Activity**: Login patterns, session data
- **Performance Metrics**: Response times, error rates

### Metabase Integration

Configure Metabase integration via environment variables:

```env
ANALYTICS_INTEGRATION=METABASE
METABASE_URL=https://your-metabase-instance.com
METABASE_API_KEY=your_metabase_api_key
```

### Available Dashboards

- 📈 **Call Patterns** - Call volume, duration trends
- 💡 **Nudge Effectiveness** - Nudge usage and impact
- ⚠️ **Error Rates** - System errors and exceptions
- 👥 **Counselor Performance** - Counselor activity and metrics
- 📊 **User Engagement** - User activity and retention
- 🎯 **Session Analytics** - Session quality and outcomes

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

## 💡 Future Enhancements

- 🌍 **Multi-language Transcription** - Support for multiple languages
- 📼 **Call Recording & Downloads** - Record and download call audio
- 🤝 **CRM Integrations** - HubSpot, Salesforce integrations
- 📤 **Webhook-based Exports** - Real-time data exports via webhooks
- 🧠 **AI Feedback for Counselors** - AI-powered counselor coaching
- 📱 **Mobile SDK** - Native mobile app support
- 🔐 **Enhanced Security** - Additional security features and compliance
- 📊 **Advanced Analytics** - More detailed analytics and reporting

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

# Run e2e tests
npm run test:e2e
```

### Code Standards

The project follows:
- ✅ NestJS best practices and conventions
- ✅ TypeScript strict mode
- ✅ ESLint + Prettier configuration
- ✅ No unused imports
- ✅ Comprehensive error handling
- ✅ Type-safe DTOs with class-validator
- ✅ Modular architecture

---

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

## 📜 License

MIT

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

## 📜 License

MIT License - see LICENSE file for details
