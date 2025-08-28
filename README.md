
# 📞 Helpline Counseling Platform

A real-time mental health counseling platform built with NestJS that connects patients with counselors through voice communication. Now upgraded with AI-powered call transcription, live nudges, summaries, and analytics.

---

## 🚀 Features

- 💬 Real-time chat using WebSocket (Socket.io)
- 📞 WebRTC peer-to-peer audio call support
- 🔁 Third-party voice call ingestion (Twilio, Knowlarity, MSG91)
- 🧠 AI-powered transcription with Deepgram
- 💡 Real-time nudges during calls
- 📋 Post-call summaries
- 📊 Call and chat analytics (Metabase)
- 🧾 Message history with pagination
- 🧠 Sentiment analysis (optional)
- 🛡️ Secure authentication system (Email/OTP via Twilio/MSG91/Knowlarity)
- 🗃️ Redis for session caching
- 🔐 PostgreSQL for persistent storage
- 🛠️ Exception alerts via Slack
- 📄 API Documentation with Swagger

---

## 🧩 System Architecture

```
                   +----------------------+
                   |   Auth Service       |
                   | (Email/OTP Login)    |
                   +----------+-----------+
                              |
                              v
                     +--------+--------+
                     | Signaling Server | 
                     +--------+--------+
                              |
                              v
                     +--------+--------+                         +------------------+
+-----------------+  |  Audio Stream    |  <-------------------> | Third-party API  |
| WebRTC Client   |  |  Receiver (WS)   |     (via WebSocket)    | (Twilio, etc.)   |
| (Web/App)       |  +--------+--------+                         +------------------+
+-----------------+           |
                              v
                     +--------+--------+
                     |  Transcription   |
                     |   Engine (WS)    |
                     |   Deepgram API   |
                     +--------+--------+
                              |
                              v
                       +------+------+
                       | AI Engine    |
                       | (Nudges,     |
                       |  Summary)    |
                       +------+------+
                              |
                              v
                   +------------------------+          +-------------------+
                   | Message and Nudge DB   |          |   Exceptions      | 
                   |      (Postgres)        |          |                   |
                   +----------+-------------+          +-------------------+
                              |                                  |
                              v                                  v
                   +------------------------+
                   |  Metabase Dashboards   |          +-------------------+
                   |                        |          |       Slack       |
                   +------------------------+          +-------------------+

Slack alerts triggered from any component
```

---

## 🛠️ Technology Stack

| Component         | Tech Used                               |
|------------------|------------------------------------------|
| Backend          | NestJS                                   |
| Database         | PostgreSQL                               |
| Caching          | Redis                                    |
| Real-time Comm   | WebSocket (Socket.io), WebRTC, TURN/STUN |
| Transcription    | Deepgram (WebSocket API)                 |
| AI Engine        | LLM / internal models                    |
| Authentication   | JWT, OTP (Twilio, MSG91, Knowlarity)     |
| Analytics        | PostgreSQL + Metabase                    |
| Observability    | Winston Logger + Slack alerts            |
| Documentation    | Swagger/OpenAPI                          |

---

## 📦 Environment Configuration

Create a `.env` file in the root directory with the following:

```env
# Server
PORT=3000
NODE_ENV=development

# JWT Configuration
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
REFRESH_TOKEN_TTL_DAYS=7

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=your_database 

# AI Service
AI_SERVICE_API_URL=http://localhost:3001
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=your_redis_prefix_here

# SMS
SMS_INTEGRATION=msg91
MSG91_API_KEY=your_msg91_api_key_here
MSG91_TEMPLATE_ID=your_msg91_template_id_here
MSG91_API_URL=https://control.msg91.com/api/v5/flow

# AUDIO_INGEST_INTEGRATION
AUDIO_INGEST_INTEGRATION=EXOTEL

# OTP
OTP_TTL=300  #in seconds

# ANALYTICS
ANALYTICS_INTEGRATION=METABASE
METABASE_URL=https://metabase.com
METABASE_API_KEY=your_metabase_api_key_here

# AWS_SMTP
SMTP_REGION=smtp-region
SMTP_ACCESS_KEY_ID=smtp-access-key-id
SMTP_SECRET_ACCESS_KEY=smtp-secret-access-key

# AWS
AWS_REGION=aws-region
AWS_ACCESS_KEY_ID=aws-access-key-id
AWS_SECRET_ACCESS_KEY=aws-secret-access-key

# EMAIL
EMAIL_INTEGRATION=aws-ses

# AWS-SES
SES_SOURCE_EMAIL=ses-source-email

# Audio upload
AUDIO_STORAGE_S3_BUCKET=audio-storage-s3-bucket

# AI service API key
AI_SERVICE_API_KEY=ai-service-api-key

# Audio storage directiry
AUDIO_STORAGE_DIR=audio-storage

# Cloud telephony credentials encryption key
CLOUD_TELEPHONY_CREDENTIALS_ENCRYPTION_KEY=cloud-teleophony-credentials-encryption-key

# Ozonetel API URL
OZONETEL_API_URL=ozonetel-api-url

# API base URL
API_BASE_URL=api-base-url
```

---

## 🧪 Testing & Observability

- ✅ Jest for unit testing
- ✅ Integration testing for chat/call flow
- 🔍 Winston structured logging
- 📊 Slack alerts via webhook
- 📈 Metabase dashboards for usage patterns, call insights

---

## 🧭 Usage Guide

### Development
```bash
npm install
npm run start:dev
```

### Production
```bash
npm run build
npm run start:prod
```

### Migrations
```bash
npm run migration:run
```

---

## 📊 Analytics with Metabase

Call/chat metadata stored in PostgreSQL:
- Call duration
- Call source (WebRTC / Provider)
- Keywords/topics
- Nudges triggered
- Sentiment scores (optional)

Visual dashboards embedded via Metabase:
- Call patterns
- Nudge effectiveness
- Error rates
- Counselor performance

---

## 💡 Future Enhancements

- 🌍 Multi-language transcription
- 📼 Call recording & downloads
- 🤝 CRM integrations (HubSpot, Salesforce)
- 📤 Webhook-based exports
- 🧠 AI feedback for counselors

---

## 🧹 Code Quality

Run linter with:

```bash
npm run lint
```

Follows:
- NestJS best practices
- Type safety
- No unused imports

---

## 📜 License

MIT

---

## 👥 Contributing

1. Fork the repo  
2. Branch: `feature/<your-name>/<feature>`  
3. Code and lint: `npm run lint`  
4. Commit and push  
5. Open a pull request
