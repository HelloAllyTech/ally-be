# Docker Testing Setup - Fixes Applied


### 1. Orphan Container Warnings
**Problem**: Dev containers (ally-be-app-1, ally-be-postgres-1, localstack, ally-be-redis-1) were being detected as orphans when running tests.

**Solution**: Added `--remove-orphans` flag to all docker-compose commands in `test-docker.sh`:
- `docker-compose -f compose.test.yaml run --rm --remove-orphans test-runner`
- `docker-compose -f compose.test.yaml down -v --remove-orphans`

### 2. LocalStack Healthcheck Improvements
**Problem**: Healthcheck was too strict and could fail before LocalStack was fully initialized.

**Solution**: Improved healthcheck configuration:
```yaml
healthcheck:
  test: ["CMD", "bash", "-c", "curl -sf http://localhost:4566/_localstack/health || exit 1"]
  interval: 5s      # Check every 5 seconds
  timeout: 10s      # Allow 10 seconds for each check
  retries: 10       # Try up to 10 times
  start_period: 15s # Give 15 seconds grace period on startup
```

## How to Use

### First Time Setup
```bash
cd /Users/ajey/workspace/ally/ally-be

# Clean any existing containers
./test-docker.sh clean

# Run tests (first run will build Docker image - takes ~5-10 minutes)
./test-docker.sh all
```

### Subsequent Runs
```bash
# Run tests (much faster after first build)
./test-docker.sh all

# Run e2e tests
./test-docker.sh e2e

# Run with coverage
./test-docker.sh coverage
```

### If You Get Errors

1. **Clean everything and start fresh:**
   ```bash
   ./test-docker.sh clean
   docker-compose -f compose.test.yaml down -v --remove-orphans
   ./test-docker.sh all
   ```

2. **Check service status:**
   ```bash
   docker-compose -f compose.test.yaml ps
   ```

3. **View service logs:**
   ```bash
   docker-compose -f compose.test.yaml logs localstack-test
   docker-compose -f compose.test.yaml logs postgres-test
   docker-compose -f compose.test.yaml logs redis-test
   ```

## What's Running During Tests

When you run `./test-docker.sh all`, these services start:

1. **postgres-test** - PostgreSQL database (healthy status required)
2. **redis-test** - Redis cache (healthy status required)
3. **localstack-test** - AWS services emulation (healthy status required)
4. **sqs-setup-test** - Automatically creates SQS queues (completes and exits)
5. **test-runner** - Runs your Jest tests (ephemeral, removed after completion)

All services use tmpfs (temporary in-memory storage) for speed and clean state.

## Performance Notes

- **First run**: ~5-10 minutes (builds Docker image, installs dependencies)
- **Subsequent runs**: ~30-60 seconds (reuses cached image)
- **Clean build**: Use `docker-compose -f compose.test.yaml build --no-cache` if needed

## Troubleshooting

### Port Conflicts
If you see port conflicts, stop dev containers:
```bash
docker-compose down
```

### Permission Issues
Ensure the script is executable:
```bash
chmod +x test-docker.sh
```

### Out of Disk Space
Clean up unused Docker resources:
```bash
docker system prune -a --volumes
```

### LocalStack Not Starting
Check LocalStack logs:
```bash
docker-compose -f compose.test.yaml logs localstack-test
```

Common issues:
- Insufficient memory allocated to Docker
- tmpfs mount conflicts (should be fixed now)
- Port 4566 already in use

## Files Modified

1. **test-docker.sh** - Added `--remove-orphans` flag to all commands
2. **compose.test.yaml** - Fixed LocalStack tmpfs mount and healthcheck
3. **TESTING.md** - Comprehensive testing documentation
4. **package.json** - Added npm scripts for Docker tests

## Next Steps

After the initial build completes, you can:
1. Run tests regularly with `./test-docker.sh all`
2. Use watch mode during development: `./test-docker.sh watch`
3. Generate coverage reports: `./test-docker.sh coverage`
4. Integrate with CI/CD (see TESTING.md for GitHub Actions example)
