# Testing Guide for ally-be

This document explains how to run tests for the ally-be backend using Docker containers.

## Overview

The ally-be project uses Jest for testing and provides Docker-based test infrastructure for:
- **Unit tests**: Testing individual modules and services
- **End-to-end (E2E) tests**: Testing complete API flows
- **Coverage reports**: Analyzing code coverage

## Quick Start

### Run All Unit Tests
```bash
./test-docker.sh all
# or
npm run test:docker
```

### Run End-to-End Tests
```bash
./test-docker.sh e2e
# or
npm run test:docker:e2e
```

### Run Tests with Coverage
```bash
./test-docker.sh coverage
# or
npm run test:docker:coverage
```

### Run Tests in Watch Mode
```bash
./test-docker.sh watch
# or
npm run test:docker:watch
```

### Clean Up Test Containers
```bash
./test-docker.sh clean
# or
npm run test:docker:clean
```

## Test Infrastructure

### Services

The test environment includes the following services:

1. **postgres-test**: PostgreSQL 14 database with test data (uses tmpfs for speed)
2. **redis-test**: Redis cache (uses tmpfs for speed)
3. **localstack-test**: AWS service emulation (SQS, S3, SES, CloudWatch Logs)
4. **sqs-setup-test**: Automatically creates required SQS queues
5. **test-runner**: Runs Jest unit tests
6. **test-coverage**: Runs tests with coverage analysis
7. **test-e2e**: Runs end-to-end integration tests

### Test Environment Variables

Tests run with the following configuration:
- `NODE_ENV=test`
- `CI=true`
- Database: `postgres-test:5432/ally_test` (user: test, password: test)
- Redis: `redis-test:6379`
- LocalStack: `http://localstack-test:4566`
- JWT: Test secret key for authentication

All services are isolated in a `test-network` and use temporary storage (tmpfs) for fast, clean test runs.

## File Structure

```
ally-be/
├── compose.test.yaml       # Docker Compose configuration for tests
├── test-docker.sh          # Test runner script
├── src/                    # Source code
│   └── **/*.spec.ts        # Unit test files
└── test/                   # E2E test configuration
    ├── jest-e2e.json       # E2E Jest configuration
    └── **/*.e2e-spec.ts    # E2E test files
```

## Writing Tests

### Unit Tests

Unit tests should be placed next to the code they test with a `.spec.ts` extension:

```typescript
// src/users/service/user.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from '../user.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserService],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

### E2E Tests

E2E tests should be placed in the `test/` directory with a `.e2e-spec.ts` extension:

```typescript
// test/users.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('UsersController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/users (GET)', () => {
    return request(app.getHttpServer())
      .get('/users')
      .expect(200);
  });
});
```

## Testing Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Clean State**: Use `beforeEach` and `afterEach` to set up and tear down test data
3. **Mock External Services**: Mock external APIs and services to avoid dependencies
4. **Test Coverage**: Aim for high coverage but focus on meaningful tests
5. **Fast Tests**: Keep unit tests fast by avoiding real database/network calls
6. **E2E for Critical Paths**: Use E2E tests for critical user flows

## Troubleshooting

### Tests Fail to Connect to Database

Ensure the database service is healthy:
```bash
docker-compose -f compose.test.yaml ps
```

You should see `postgres-test` with status "Up (healthy)".

### Port Conflicts

If you get port conflicts, stop the development containers:
```bash
docker-compose down
```

Then run tests again.

### Clean Start

For a completely clean test run:
```bash
./test-docker.sh clean
docker-compose -f compose.test.yaml down -v --remove-orphans
./test-docker.sh all
```

### Debugging Tests

To debug tests, you can run them with the Node inspector:
```bash
docker-compose exec app npm run test:debug
```

Then attach your debugger to the process.

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build Docker images
        run: docker-compose -f compose.test.yaml build

      - name: Run unit tests
        run: docker-compose -f compose.test.yaml run --rm test-runner

      - name: Run e2e tests
        run: docker-compose -f compose.test.yaml run --rm test-e2e

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          directory: ./coverage
```

## Performance Tips

1. **Parallel Tests**: Jest runs tests in parallel by default
2. **tmpfs**: Test services use temporary file systems for speed
3. **Layer Caching**: Docker layer caching speeds up subsequent builds
4. **Watch Mode**: Use watch mode during development for instant feedback

## Additional Resources

- [Jest Documentation](https://jestjs.io/)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [LocalStack Documentation](https://docs.localstack.cloud/)

## Support

For issues or questions:
1. Check this documentation
2. Review test logs: `docker-compose -f compose.test.yaml logs`
3. Contact the development team
