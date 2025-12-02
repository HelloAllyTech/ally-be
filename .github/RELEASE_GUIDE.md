# Production Release Guide - Ally Core Backend

This guide explains how to create production releases for the Ally Core Backend application using the automated release pipeline with semantic versioning and release drafts.

## Table of Contents
- [Quick Start](#quick-start)
- [Semantic Versioning](#semantic-versioning)
- [Release Process](#release-process)
- [What Happens Automatically](#what-happens-automatically)
- [After Deployment](#after-deployment)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites
- All changes merged to **master** branch
- Tests passing locally or in CI
- Code review completed

### How to Release

1. **Go to GitHub Actions**
   - Navigate to: `https://github.com/your-org/ally-be/actions`
   - Click on **"Production Release"** workflow

2. **Trigger the Workflow**
   - Click **"Run workflow"** button (top right)
   - Select branch: **master**
   - Enter version tag: `v1.2.3` (format: `vMAJOR.MINOR.PATCH`)
   - Click **"Run workflow"**

3. **Monitor Deployment**
   - Watch the pipeline execute automatically
   - All jobs must complete successfully

4. **Publish Release**
   - Go to **GitHub Releases**
   - Find the draft release
   - Review and edit changelog
   - Click **"Publish release"**

**That's it!** The workflow automatically creates the git tag, builds, tests, deploys, and creates a release draft.

---

## Semantic Versioning

We follow [Semantic Versioning 2.0.0](https://semver.org/): `vMAJOR.MINOR.PATCH`

### Version Types

**MAJOR (X.0.0)** - Breaking Changes
- Incompatible API changes
- Major architecture changes
- Removed features or endpoints
- Example: `v1.5.3` → `v2.0.0`

**MINOR (0.X.0)** - New Features
- New features (backward compatible)
- New API endpoints
- Enhancements
- Example: `v1.5.3` → `v1.6.0`

**PATCH (0.0.X)** - Bug Fixes
- Bug fixes only
- Performance improvements
- Security patches
- Example: `v1.5.3` → `v1.5.4`

### Version Examples
- `v1.0.0` - First production release
- `v1.1.0` - Added new features, backward compatible
- `v1.1.1` - Bug fixes only
- `v2.0.0` - Breaking changes or major refactor

---

## Release Process

### Step 1: Determine Version Number

Review changes since the last release:

```bash
# View current version
git tag -l "v*" --sort=-v:refname | head -1
# Output: v1.2.3

# View changes since last release
git log v1.2.3..master --oneline

# Decide version bump
# - Only bug fixes? → v1.2.4 (PATCH)
# - New features? → v1.3.0 (MINOR)
# - Breaking changes? → v2.0.0 (MAJOR)
```

### Step 2: Trigger Release Workflow

1. Go to **GitHub Actions**: `https://github.com/your-org/ally-be/actions`
2. Select **"Production Release"** from the workflows list
3. Click **"Run workflow"** button
4. Fill in the form:
   - **Branch**: `master`
   - **Version tag**: `v1.2.3` (your chosen version)
5. Click **"Run workflow"** to start

**Note**: You don't need to create the git tag manually - the workflow creates it for you!

### Step 3: Monitor Pipeline Execution

The workflow runs these jobs automatically:

1. ✅ **Validate Version and Create Tag**
   - Validates tag format (`vX.Y.Z`)
   - Checks if tag already exists
   - Ensures version is newer than latest tag
   - Handles first-time releases (no previous tags)
   - Creates git tag on master branch
   - Pushes tag to repository

2. ✅ **Prepare Production Environment**
   - Sets AWS credentials
   - Configures ECS cluster and service names
   - Uses ally-core service configuration

3. ✅ **Run Tests**
   - Sets up Node.js 18
   - Installs dependencies with npm
   - Runs test suite with Jest
   - Pipeline fails if any tests fail

4. ✅ **Build Docker Image**
   - Builds Docker image from master
   - Creates multiple version tags:
     - `1.2.3` - Exact version (immutable)
     - `1.2` - Major.Minor (rolling)
     - `1` - Major only (rolling)
     - `latest` - Latest release
     - `{sha}-{run}` - Unique build ID
   - Pushes all tags to ECR

5. ✅ **Run Database Migration**
   - Runs database migrations
   - Uses the versioned Docker image
   - Executes as ECS task

6. ✅ **Deploy to Production**
   - Updates ECS task definition
   - Deploys to production ECS service
   - Waits for service stability

7. ✅ **Create Release Draft**
   - Generates changelog from git commits
   - Includes version and deployment info
   - Creates draft release in GitHub

---

## What Happens Automatically

### Git Tagging
- Workflow creates tag on **master** branch
- Tag format validated: `v{major}.{minor}.{patch}`
- Prevents duplicate tags
- Ensures new version is higher than existing tags
- Handles first-time releases gracefully

### Docker Image Tags

For release `v1.2.3`, these Docker images are created:

| Tag | Purpose | Updates |
|-----|---------|---------|
| `1.2.3` | Exact version | Never (immutable) |
| `1.2` | Major.Minor | With patch releases |
| `1` | Major only | With minor/patch releases |
| `latest` | Latest release | Every release |
| `{sha}-{run}` | Unique build ID | Never |

### Release Draft

The workflow automatically creates a draft release containing:

- **Version Information**: Major, Minor, Patch numbers
- **Service Information**: ally-core (Backend) deployment details
- **Deployment Details**: ECS cluster, service, Docker image
- **Auto-generated Changelog**: Git commits since last release
- **GitHub Release Notes**: Auto-generated from PRs and commits

---

## After Deployment

### Review Release Draft

1. **Navigate to Releases**
   - Go to: `https://github.com/your-org/ally-be/releases`
   - Find the draft release (marked with "Draft")

2. **Review Content**
   - Check auto-generated changelog
   - Verify deployment information
   - Review commit history

3. **Edit Release Notes** (Optional)
   Add these sections if needed:
   - **Highlights**: Key features or changes
   - **Breaking Changes**: For major versions
   - **Migration Guide**: Database or config changes
   - **API Changes**: New or modified endpoints
   - **Known Issues**: Any limitations
   - **Contributors**: Special acknowledgments

4. **Publish Release**
   - Click **"Publish release"** button
   - Release becomes public
   - GitHub notifies watchers

### Verify Deployment

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster ally-prd-mb-ecs-cluster \
  --services ally-prd-svc-core

# View running tasks
aws ecs list-tasks \
  --cluster ally-prd-mb-ecs-cluster \
  --service-name ally-prd-svc-core

# Check application logs
aws logs tail /ecs/ally-prd-cntr-core --follow
```

### Test API Endpoints

```bash
# Health check
curl https://api.yourapp.com/health

# Version endpoint (if available)
curl https://api.yourapp.com/version
```

---

## Troubleshooting

### Tag Already Exists

**Error**: "Tag v1.2.3 already exists"

**Solution**:
- Choose a different version number
- Or delete the existing tag if it was created by mistake:
  ```bash
  git tag -d v1.2.3
  git push origin :refs/tags/v1.2.3
  ```

### Version Not Newer Than Latest

**Error**: "Tag v1.2.0 is not newer than the latest tag v1.5.0"

**Solution**: Use a version number higher than the current latest tag

```bash
# Check current latest tag
git tag -l "v*" --sort=-v:refname | head -1
# Output: v1.5.0

# Your new version must be higher
# ✅ Correct: v1.5.1, v1.6.0, v2.0.0
# ❌ Wrong: v1.4.0, v1.0.0, v1.5.0
```

This validation prevents accidentally releasing older versions and ensures semantic versioning order is maintained.

### Invalid Tag Format

**Error**: "Tag must be in format v{major}.{minor}.{patch}"

**Solution**: Ensure tag follows exact format:

```bash
# ✅ Correct
v1.2.3
v2.0.0
v1.0.1

# ❌ Incorrect
1.2.3          # Missing 'v' prefix
v1.2           # Missing patch version
v1.2.3-beta    # No pre-release suffixes
v1.2.3-rc1     # No pre-release suffixes
```

### Tests Fail

**Error**: Test job fails in pipeline

**Solution**:
1. Run tests locally:
   ```bash
   npm ci
   npm run test -- --forceExit --detectOpenHandles
   ```
2. Fix failing tests
3. Commit and push fixes to master
4. Re-run the workflow with same version tag
5. If tag was created, delete it first:
   ```bash
   git push origin :refs/tags/v1.2.3
   ```

### Build Fails

**Error**: Docker build fails

**Solution**:
- Check Dockerfile syntax
- Verify all dependencies are available
- Check build logs in GitHub Actions
- Ensure ECR repository exists and has permissions

### Deployment Fails

**Error**: ECS deployment fails

**Solution**:

1. **Check AWS Credentials**
   - Verify GitHub repository variables:
     - `PRD_AWS_ROLE`
     - `PRD_AWS_REGION`
     - `PRD_ECR_REPOSITORY`

2. **Verify ECS Resources**
   ```bash
   # Check cluster exists
   aws ecs describe-clusters --clusters ally-prd-mb-ecs-cluster
   
   # Check service exists
   aws ecs describe-services \
     --cluster ally-prd-mb-ecs-cluster \
     --services ally-prd-svc-core
   ```

3. **Review CloudWatch Logs**
   - Check ECS task logs for errors
   - Review deployment events

4. **Check Task Definition**
   - Ensure task definition is compatible
   - Verify CPU/memory limits
   - Check IAM role permissions

### Database Migration Fails

**Error**: Migration job fails

**Solution**:
1. Check migration scripts for errors
2. Verify database connectivity
3. Check database user permissions
4. Review migration logs in CloudWatch
5. Fix migration and re-deploy

### Rollback a Release

If you need to rollback to a previous version:

**Option 1: Manual ECS Rollback**
1. Go to AWS ECS Console
2. Select your service: `ally-prd-svc-core`
3. Click **"Update"**
4. Select previous task definition revision
5. Click **"Update service"**

**Option 2: Re-run Previous Version**
1. Go to GitHub Actions
2. Trigger workflow with previous version tag
3. Example: If v1.2.3 failed, deploy v1.2.2

---

## Best Practices

### Before Release
- ✅ Test thoroughly in dev/staging
- ✅ Run full test suite locally
- ✅ Review all PRs merged since last release
- ✅ Update API documentation
- ✅ Prepare release notes

### Version Selection
- ✅ Use MAJOR for breaking API changes
- ✅ Use MINOR for new endpoints/features
- ✅ Use PATCH for bug fixes only
- ✅ Document breaking changes clearly
- ✅ Group related features in one release

### Release Frequency
- ✅ Release regularly (weekly/bi-weekly)
- ✅ Don't batch too many changes
- ✅ Quick patches for critical bugs
- ✅ Plan major releases carefully

### Documentation
- ✅ Write clear release notes
- ✅ Highlight user-facing API changes
- ✅ Document migration steps
- ✅ Note breaking changes prominently
- ✅ Link to relevant PRs/issues

### Post-Release
- ✅ Monitor application logs
- ✅ Check error rates and metrics
- ✅ Verify all API endpoints working
- ✅ Test critical user flows
- ✅ Communicate to team/users
- ✅ Update API documentation

---

## Configuration

### Required GitHub Variables

Set these in: **Repository Settings → Secrets and variables → Actions → Variables**

```
PRD_AWS_ROLE          # AWS IAM role ARN for production
PRD_AWS_REGION        # AWS region (e.g., ap-south-1)
PRD_ECR_REPOSITORY    # ECR repository URL
```

### ECS Resources

The pipeline deploys to:
- **Service**: `ally-core` (Backend)
- **Cluster**: `ally-prd-mb-ecs-cluster`
- **Service Name**: `ally-prd-svc-core`
- **Task Definition**: `ally-prd-td-core`
- **Container**: `ally-prd-cntr-core`
- **ECR Image**: `ally-prd-ecr-core`

### Tech Stack

- **Runtime**: Node.js 18
- **Package Manager**: npm
- **Test Framework**: Jest
- **Container Platform**: Docker
- **Deployment**: AWS ECS

---

## Support

For issues with the release pipeline:

1. **Check Logs**
   - GitHub Actions workflow logs
   - AWS CloudWatch logs
   - ECS service events

2. **Review This Guide**
   - Follow troubleshooting steps
   - Verify configuration

3. **Contact Team**
   - DevOps team for infrastructure issues
   - Backend team for application issues

4. **Open Issue**
   - Create issue in repository
   - Include error logs and steps to reproduce

