# Job Service: Quick Reference

## What is This Service?

A REST API that manages the lifecycle of computational jobs. Think of it as a "job coordinator" that:

- Stores job definitions
- Tracks job status (QUEUED → RUNNING → COMPLETED/FAILED)
- Prevents duplicate submissions
- Publishes events when jobs change state

## Who Uses It?

- **Users/Clients**: Create jobs via HTTP API
- **Scheduler**: Fetches QUEUED jobs and transitions them to RUNNING
- **Workers**: Update job status as execution progresses
- **Other services**: Subscribe to job events via message queue

## The Three Patterns

### 1. **Idempotency** (Prevent Duplicates)

Every job creation needs a unique key:

```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Idempotency-Key: my-unique-key-123" \
  -H "Authorization: Bearer <token>" \
  -d '{ "jobType": "batch", ... }'

# Safe to retry with same key - no duplicates created
```

### 2. **State Machine** (Enforce Rules)

Only certain transitions are allowed:

```
QUEUED ──► RUNNING ──► COMPLETED ✓ (done)
            ├──────► FAILED ✓ (done)
            └──────► CANCELLED ✓ (done)
```

Trying `COMPLETED → RUNNING` will error. Prevents invalid state.

### 3. **Outbox Pattern** (Reliable Events)

When a job is created or changes state, an event is inserted into the database **in the same transaction** as the job itself.

A background poller (every 5 seconds) reads unpublished events and sends them to the message queue.

Why? If the server crashes after creating a job but before publishing the event, the event is still in the database and will be published on recovery. **No events are lost.**

## HTTP API Cheat Sheet

### Create Job

```bash
POST /api/v1/jobs
Headers:
  Authorization: Bearer <token>
  Idempotency-Key: <unique-key>
Body:
{
  "jobType": "batch",
  "runtime": "node18",
  "entrypoint": ["node", "main.js"],
  "resources": { "cpu": 1, "memoryMB": 512 },
  "inputArtifacts": { "code": "s3://bucket/app.zip" }
}
```

### Get Job

```bash
GET /api/v1/jobs/:id
Headers:
  Authorization: Bearer <token>
```

### List Jobs

```bash
GET /api/v1/jobs?limit=50&offset=0
Headers:
  Authorization: Bearer <token>
```

### Cancel Job

```bash
POST /api/v1/jobs/:id/cancel
Headers:
  Authorization: Bearer <token>
```

### Update Job State (Internal)

```bash
POST /api/v1/internal/jobs/:id/state
Headers:
  X-Internal-Token: <internal-token>
Body:
{
  "status": "RUNNING",
  "startedAt": "2026-02-12T10:05:00Z"
}
```

### Health Check

```bash
GET /health
```

## Code Organization

```
src/
├── api/v1/
│   ├── jobs/           # Public job endpoints
│   │   ├── job.controller.ts    # HTTP handlers
│   │   └── job.routes.ts        # Route definitions
│   ├── internal/       # Internal state updates
│   │   └── internal.routes.ts
│   └── health/         # Health check
├── services/job/
│   ├── job.service.ts        # Business logic
│   ├── job.repository.ts     # Database access
│   └── job.state.ts          # State machine rules
├── middlewares/
│   ├── auth.middleware.ts         # JWT validation
│   └── internal.middleware.ts     # Internal token
├── validators/
│   └── job.schema.ts         # Input validation (Zod)
├── types/
│   ├── auth.ts               # Auth types
│   └── job.types.ts          # Job types
├── libs/
│   ├── logger.ts             # Pino logger
│   └── prisma.ts             # Prisma client
├── config/
│   └── config.ts             # Configuration
└── index.ts                  # Entry point
```

## Database Tables

| Table              | Purpose                     |
| ------------------ | --------------------------- |
| `jobs`             | Job definitions & status    |
| `job_attempts`     | Track retry attempts        |
| `idempotency_keys` | Prevent duplicate creation  |
| `outbox_events`    | Events awaiting publication |

## Common Tasks

### Run Locally

```bash
bun install
cp .env.example .env
bun run prisma:migrate
bun run dev
```

### Setup Database

```bash
bun run prisma:migrate    # Create/update schema
bun run prisma:studio    # Browse data with UI
```

### Build for Production

```bash
bun run build
bun run start
```

### Docker

```bash
docker build -t job-service .
docker run -p 3000:3000 -e DATABASE_URL="..." job-service
```

## Key Files Explained

- **prisma/schema.prisma**: Database models
- **src/services/job/job.state.ts**: State transition logic (pure function)
- **src/index.ts**: Server bootstrap & outbox polling setup
- **src/api/v1/jobs/job.routes.ts**: HTTP route definitions

## What Happens Behind the Scenes

### When You Create a Job:

1. Request arrives with JWT token
2. JWT is decoded, user extracted
3. Request body validated against Zod schema
4. Idempotency-Key checked - if duplicate, return existing job
5. New job inserted into `jobs` table
6. Outbox event inserted into `outbox_events` table (same transaction!)
7. Both commit together - atomicity guaranteed
8. Response returned with job ID

### Every 5 Seconds:

1. Background poller wakes up
2. Queries for unpublished events: `SELECT * FROM outbox_events WHERE published = false`
3. For each event, logs it (stub - would send to message queue)
4. Updates: `UPDATE outbox_events SET published = true WHERE id = ...`
5. Sleeps for 5 seconds, repeats

## Environment Variables

```env
NODE_ENV=development           # or production
LOG_LEVEL=debug                # or info, warn, error
PORT=3000                      # Server port
HOST=0.0.0.0                   # Server host
DATABASE_URL=postgresql://...  # DB connection
JWT_ENABLED=true               # Enable JWT validation
INTERNAL_TOKEN=secret          # Internal service token
```

## Troubleshooting

**"Missing Idempotency-Key" Error**

- Add `Idempotency-Key` header to POST /api/v1/jobs request

**"Invalid state transition" Error**

- Trying to move job from invalid state (e.g., COMPLETED → RUNNING)
- Check allowed transitions above

**"Unauthorized" Error**

- Missing or expired JWT token
- Verify token from Auth Service

**"Forbidden" Error**

- Wrong `X-Internal-Token` for internal endpoints
- Verify `INTERNAL_TOKEN` env var

## Performance Notes

- **Polling interval**: 5 seconds (good balance between latency & CPU)
- **Max job list**: 100 items per page (hardcoded)
- **Idempotency**: O(1) lookup by key + user_id
- **Database indexes**: Created on status, createdAt, ownerUserId

## Next Steps

1. Replace stub event publisher with actual RabbitMQ/Kafka client
2. Add Prometheus metrics (job creation rate, state transitions, etc.)
3. Build Scheduler service to consume QUEUED jobs
4. Build Worker service to execute jobs and update status
5. Add job history/archival for old completed jobs
