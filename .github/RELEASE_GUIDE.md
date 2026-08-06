# Release Guide — ally-be

**The shared release process lives in the wiki:
[Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md).**
Read that for semantic-versioning policy, how to trigger the workflow, the image tag
scheme, publishing the draft, and troubleshooting. This file carries only what is specific
to this service.

## This service

| | |
|---|---|
| Workflow | **Production Release** (`.github/workflows/production-release.yaml`) |
| Release branch | `master` |
| Runtime in CI | Node.js 24 |
| Package manager | npm |
| Test framework | Jest |
| Deployment | AWS ECS |
| Runs migrations | **Yes** — as an ECS task, using the versioned image, before deploy |

## Deployment target

- **Service**: `ally-core` (Backend)
- **Cluster**: `ally-prd-mb-ecs-cluster`
- **ECS service**: `ally-prd-svc-core`
- **Task definition**: `ally-prd-td-core`
- **Container**: `ally-prd-cntr-core`
- **ECR image**: `ally-prd-ecr-core`

## Required repository variables

Settings → Secrets and variables → Actions → Variables:

```
PRD_AWS_ROLE          # AWS IAM role ARN for production
PRD_AWS_REGION
PRD_ECR_REPOSITORY
```

## Verify a deployment

```bash
aws ecs describe-services \
  --cluster ally-prd-mb-ecs-cluster \
  --services ally-prd-svc-core

aws ecs list-tasks \
  --cluster ally-prd-mb-ecs-cluster \
  --service-name ally-prd-svc-core

aws logs tail /ecs/ally-prd-cntr-core --follow
```

## Notes specific to this service

- **Migrations run before the deploy.** A failed migration stops the release with the old
  version still serving. Fix forward — never edit a migration that has already merged.
- Reproduce a failing pipeline test locally with
  `npm ci && npm run test -- --forceExit --detectOpenHandles`.
- Migration failures: check the migration, database connectivity, and the database user's
  permissions, then read the migration task's CloudWatch logs.
