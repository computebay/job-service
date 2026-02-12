# Job Service Architecture & System Flow

## Overview

The Job Service manages the complete lifecycle of computational jobs in the ComputeBay platform. It acts as the single source of truth for job state, ensures idempotent operations, and publishes events for downstream systems (schedulers, workers, notification services).

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    External Services                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Auth Service │  │   Scheduler  │  │ Worker/Executor   │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬─────────┘ │
│         │ JWT              │ internal token     │            │
└─────────┼──────────────────┼────────────────────┼────────────┘
          │                  │                    │
    ┌─────▼──────────────────▼────────────────────▼────────┐
    │           Job Service (Fastify)                      │
    │  ┌──────────────────────────────────────────────────┤
    │  │ Public Routes (JWT protected)                    │
    │  │ • POST /api/v1/jobs           → Create job       │
    │  │ • GET /api/v1/jobs/:id        → Get job          │
    │  │ • GET /api/v1/jobs            → List jobs        │
    │  │ • POST /api/v1/jobs/:id/cancel→ Cancel job       │
    │  └──────────────────────────────────────────────────┤
    │  │ Internal Routes (internal token protected)       │
    │  │ • POST /api/v1/internal/jobs/:id/state          │
    │  │         → Update job state (from scheduler)      │
    │  └──────────────────────────────────────────────────┤
    │  │ Health Check                                      │
    │  │ • GET /health                                     │
    │  └──────────────────────────────────────────────────┘
    └─────────────────┬──────────────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
         ▼                         ▼
    ┌─────────────────┐   ┌──────────────────┐
    │  PostgreSQL     │   │  Message Queue   │
    │  ┌─────────────┐│   │  (stub logging)  │
    │  │ jobs        ││   └──────────────────┘
    │  │ job_attempts││         ▲
    │  │ idempotency││         │
    │  │ outbox_    ││         │
    │  │  events    ││         │
    │  └─────────────┘│   5-second polling
    └─────────────────┘   publishes events
```

## Core Concepts

### 1. **Job Lifecycle**

A job progresses through these states:

```
QUEUED ──► RUNNING ──► COMPLETED
  │           ├──────► FAILED
  │           └──────► CANCELLED
  │
  └──────────► CANCELLED
```

**State Details:**

- **QUEUED**: Job created, waiting to be scheduled
- **RUNNING**: Scheduler assigned to a worker, worker is executing
- **COMPLETED**: Execution finished successfully
- **FAILED**: Execution failed, may be retried
- **CANCELLED**: User cancelled or cancelled after max retries

### 2. **Outbox Pattern (Event Sourcing)**

The Outbox Pattern ensures reliable event publishing even if the message queue is temporarily unavailable.

**How it works:**

```
1. User creates a job via POST /api/v1/jobs
                    │
                    ▼
2. Service receives request and starts DATABASE TRANSACTION
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
INSERT Job    INSERT Outbox  COMMIT TRANSACTION
              Event

3. After transaction commits, events are available in DB
                    │
                    ▼
4. Background poller (every 5 seconds) checks for unpublished events
                    │
                    ▼
5. For each unpublished event:
   - Log it (stub implementation)
   - Mark as published in DB

6. If poller crashes before marking as published:
   - Next poll cycle will retry the same events
   - No events are lost (idempotent)
```

**Why Outbox?**

Without Outbox Pattern, this could happen:

```
1. Job inserted into DB ✓
2. Send to message queue ✓
3. Server crashes before saving "published" flag
4. Next startup: Are events already in queue? Unknown! → Duplicate events

With Outbox Pattern:
1. Job AND event inserted (same transaction) ✓
2. Crash happens
3. Next startup: Check "published" flag → No → Resend → OK, no duplicates
```

### 3. **Idempotency**

Every `POST /api/v1/jobs` requires an `Idempotency-Key` header.

```
First Request:
  Header: Idempotency-Key: create-job-123

  1. Check if key exists for this user
  2. Not found → Create job
  3. Store (key, user_id, job_id) in DB
  4. Return 201 with job

Retry (same header):
  Header: Idempotency-Key: create-job-123

  1. Check if key exists for this user
  2. Found → Fetch existing job
  3. Return 200 with existing job (no duplicate created!)
```

This prevents duplicate jobs when network requests are retried.

### 4. **State Machine Validation**

The system enforces valid state transitions via a pure function:

```typescript
// Pure function - no side effects
validateStateTransition(currentStatus: JobStatus, newStatus: JobStatus)

Valid Transitions:
  QUEUED → RUNNING, CANCELLED
  RUNNING → COMPLETED, FAILED, CANCELLED
  COMPLETED → (none - terminal)
  FAILED → (none - terminal)
  CANCELLED → (none - terminal)

Invalid Transition Example:
  From COMPLETED → RUNNING → InvalidStateTransitionError
```

## Request Flow Example: Create a Job

```
1. CLIENT REQUEST
   POST /api/v1/jobs
   Headers: {
     Authorization: "Bearer <jwt_token>",
     Idempotency-Key: "job-2026-02-12-001"
   }
   Body: {
     jobType: "batch",
     runtime: "node18",
     entrypoint: ["node", "app.js"],
     resources: {...},
     inputArtifacts: {...}
   }

2. MIDDLEWARE: Auth Middleware
   - Extract & decode JWT
   - Verify token expiration
   - Inject user info into request
   - Continue to controller

3. CONTROLLER: JobController.createJob()
   - Validate request body with Zod schema
   - Extract userId & orgId from JWT
   - Extract Idempotency-Key from header
   - Call jobService.createJob()

4. SERVICE: JobService.createJob()
   - Check if Idempotency-Key exists for user
   - If exists → return existing job (no action)
   - If new → call repository.createJob()

5. REPOSITORY: JobRepository.createJob()
   START TRANSACTION:
     - Insert Job (status: QUEUED)
     - Insert JobAttempt (attempt 0)
     - Insert IdempotencyKey
     - Insert OutboxEvent (eventType: JOB_CREATED)
   COMMIT TRANSACTION

   Return created job

6. CONTROLLER: Format response
   - Convert dates to ISO strings
   - Return 201 Created with job data

7. CLIENT: Receives job
   {
     id: "550e8400-e29b-41d4...",
     status: "QUEUED",
     createdAt: "2026-02-12T10:00:00Z",
     ...
   }

8. BACKGROUND: Outbox Poller (every 5 seconds)
   - Finds unpublished OutboxEvent with eventType: JOB_CREATED
   - Logs event (stub implementation)
   - Marks as published in DB
   - Event ready for consumption by Scheduler/Workers
```

## Request Flow Example: Update Job State

```
1. SCHEDULER/WORKER REQUEST (Internal)
   POST /api/v1/internal/jobs/:id/state
   Headers: {
     X-Internal-Token: "secret-internal-token"
   }
   Body: {
     status: "RUNNING",
     startedAt: "2026-02-12T10:05:00Z"
   }

2. MIDDLEWARE: Internal Middleware
   - Extract X-Internal-Token header
   - Verify against INTERNAL_TOKEN env var
   - Continue if valid, reject if not

3. CONTROLLER: InternalJobController.updateJobState()
   - Validate request body with Zod
   - Call jobService.updateJobStatus()

4. SERVICE: JobService.updateJobStatus()
   - Fetch current job from DB
   - Validate state transition: QUEUED → RUNNING (valid)
   - Generate event type: "JOB_STARTED"
   - Call repository.updateJobStatus()

5. REPOSITORY: JobRepository.updateJobStatus()
   START TRANSACTION:
     - Update Job (status: RUNNING, startedAt: ...)
     - Insert OutboxEvent (eventType: JOB_STARTED)
   COMMIT TRANSACTION

   Return updated job

6. BACKGROUND: Outbox Poller (next 5-second cycle)
   - Finds JOB_STARTED event
   - Logs it
   - Marks as published
```

## Polling Every 5 Seconds: Why?

The 5-second interval is a trade-off:

| Interval   | Pro                                  | Con                     |
| ---------- | ------------------------------------ | ----------------------- |
| **1 sec**  | Events published quickly             | High DB load, high CPU  |
| **5 sec**  | ✓ Reasonable latency, ✓ Low overhead | Events delayed up to 5s |
| **30 sec** | Very low overhead                    | Events delayed, poor UX |

**Why 5 seconds for Job Service?**

1. **Job creation/state changes are relatively infrequent** (not thousands per second)
2. **5s delay acceptable** - users won't notice a job starting 5s later
3. **Resource efficient** - runs only 12 times per minute
4. **Prevents thundering herd** - doesn't overwhelm the queue
5. **Resilient to transient failures** - retries automatically

## Database Schema Relationships

```
Job (1)
  ├─── (1..*)  JobAttempt
  ├─── (1..*)  IdempotencyKey
  └─── (1..*)  OutboxEvent

Key Constraints:
  Job.id (UUID, PK)
  JobAttempt.jobId + attemptNo (unique)
  IdempotencyKey.key + ownerUserId (composite PK)
  OutboxEvent.aggregateId (FK → Job.id)
```

## Error Handling

| Status  | Scenario                 | Action                         |
| ------- | ------------------------ | ------------------------------ |
| **400** | Missing Idempotency-Key  | Request rejected               |
| **401** | Invalid/expired JWT      | Request rejected               |
| **403** | Wrong internal token     | Request rejected               |
| **404** | Job not found            | Not found error                |
| **409** | Invalid state transition | Conflict error                 |
| **500** | DB error, server error   | Retry with exponential backoff |

## Configuration & Environment

```env
# Service
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:pass@host/db

# Security
JWT_ENABLED=true
INTERNAL_TOKEN=secret-token-here
```

## Deployment Considerations

1. **Database Migrations**: Run `bun run prisma:migrate:deploy` before startup
2. **Outbox Polling**: Runs automatically on startup
3. **Stateless**: Multiple instances can run in parallel
4. **Load Balancing**: Use round-robin or similar

## Future Enhancements

1. **Replace stub publisher** with actual RabbitMQ/Kafka client
2. **Batch publishing** - accumulate events, send in batches
3. **Dead letter queue** - for events that fail to publish
4. **Metrics** - Prometheus integration for monitoring
5. **Caching** - Cache frequently accessed jobs
6. **Audit logging** - Track state changes with who/when/why

---

**Summary**: The Job Service is a stateless API that manages job lifecycles with strong consistency guarantees (state validation), idempotency (duplicate prevention), and reliable event publishing (outbox pattern).
