# Helpline Counseling Platform

A real-time counseling platform built with NestJS that connects counselors with patients through a secure chat system. This platform facilitates immediate mental health support through a helpline service.

## Features

- Real-time chat using WebSocket
- Secure authentication system
- Counselor-patient matching
- Message history and pagination
- Feedback system for chat messages
- Redis for session management and caching
- PostgreSQL for persistent data storage

## Tech Stack

- **Backend Framework**: NestJS
- **Database**: PostgreSQL
- **Caching**: Redis
- **Real-time Communication**: WebSocket (Socket.io)
- **Authentication**: JWT
- **API Documentation**: Swagger/OpenAPI

## Prerequisites

Make sure you have the following installed:

- Node.js (v16 or higher)
- PostgreSQL
- Redis
- npm 

## Environment Setup

Create a `.env` file in the root directory with the following variables:

DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=your_username
DB_PASSWORD=your_password
DB_DATABASE=helpline_db

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

JWT_ACCESS_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=24h
JWT_REFRESH_EXPIRES_IN=7d
JWT_ACCESS_EXPIRES_IN=15m

PORT=3000

## Installation

1. Clone the repository:

2. Install dependencies:

```bash
npm install
```

3. Run database migrations: 

```bash
npm run migration:run
```

## Running the Application

### Development Mode
```bash
# Start in development mode
npm run start:dev
```

### Production Mode
```bash
# Build the application
npm run start:prod
```

## Code Quality and Linting

The project uses ESLint for code quality and consistency. To run the linter:

```bash
# Check for linting errors
npm run lint

```

Common linting rules:
- Remove unused imports
- Use proper TypeScript types
- Follow NestJS best practices
- Maintain consistent code style



## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/<author's short name>/<feature name>`)
3. Ensure your code passes linting (`npm run lint`)
4. Commit your changes (`git commit -m 'Add some amazing feature'`)
5. Push to the branch (`git push origin feature/<author's short name>/<feature name>`)
6. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details

