# Job Service

A production-grade microservice for managing job lifecycle in the ComputeBay distributed compute platform.

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env

# Setup database
bun run prisma:generate
bun run prisma:migrate

# Run locally
bun run dev
```

Server runs on `http://localhost:3000`

## Architecture Overview

The Job Service is responsible for:
- **Job lifecycle management**: QUEUED → RUNNING → COMPLETED/FAILED/CANCELLED
- **Idempotent job creation**: Prevents duplicate job submissions
- **Outbox pattern**: Ensures reliable event publishing to message queues
- **State validation**: Enforces valid state transitions

The service does **NOT** handle:
- Job scheduling (external component)
- Job execution (workers handle this)
- Worker management
- Credit/billing tracking

## Technology Stack

- **Runtime**: Bun
- **Framework**: Fastify (HTTP)
- **Database**: PostgreSQL + Prisma ORM
- **Validation**: Zod
- **Logging**: Pino

## State Machine

Allowed transitions:
```
QUEUED -> RUNNING
QUEUED -> CANCELLED
RUNNING -> COMPLETED
RUNNING -> FAILED
RUNNING -> CANCELLED
```

Terminal states: COMPLETED, FAILED, CANCELLED

## API Endpoints

### Public (JWT required)
- `POST /api/v1/jobs` - Create job (requires `Idempotency-Key` header)
- `GET /api/v1/jobs` - List jobs
- `GET /api/v1/jobs/:id` - Get job
- `POST /api/v1/jobs/:id/cancel` - Cancel job

### Internal (X-Internal-Token required)
- `POST /api/v1/internal/jobs/:id/state` - Update job state

### Health
- `GET /health` - Health check

## Example: Create a Job

```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Idempotency-Key: job-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "batch",
    "runtime": "node18",
    "entrypoint": ["node", "app.js"],
    "resources": {"cpu": 1, "memoryMB": 512},
    "inputArtifacts": {"code": "s3://bucket/app.zip"}
  }'
```

## Database Schema

- **Job**: Core job entity with lifecycle
- **JobAttempt**: Tracks retry attempts
- **IdempotencyKey**: Prevents duplicate submissions
- **OutboxEvent**: Reliable event publishing

## Configuration

See `.env.example` for all available options.

## Docker

```bash
docker build -t job-service .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e INTERNAL_TOKEN="secret" \
  job-service
```

## License

ComputeBay - Internal Use Only
