# The Outbox Pattern Explained

## The Problem

Imagine you're building an online store. When someone places an order:

1. Save order to database ✓
2. Send "order created" event to notification service
3. Server crashes before sending email

Result: Order exists in DB, but customer never gets email. **Inconsistency!**

## Without Outbox Pattern

```typescript
// DANGEROUS - events can be lost
async function createJob(input) {
  // Step 1: Save to DB
  const job = await db.job.create(input);
  
  // Step 2: Publish event
  // ⚠️ CRASH HERE? Event lost, but DB has the job!
  await queue.publish({
    eventType: "JOB_CREATED",
    jobId: job.id
  });
  
  return job;
}
```

## With Outbox Pattern

```typescript
// SAFE - events are guaranteed
async function createJob(input) {
  return db.$transaction(async (tx) => {
    // Step 1: Save job AND event in same transaction
    const job = await tx.job.create(input);
    
    // Step 2: Save event to DB (not to queue!)
    await tx.outboxEvent.create({
      jobId: job.id,
      eventType: "JOB_CREATED",
      payload: { ... },
      published: false  // Mark as unpublished
    });
    
    // Step 3: Commit both together
    // If crash here → everything rolled back
    // If crash after → event in DB waiting to be published
  });
}
```

## How It Works: Step by Step

### Phase 1: Event Creation (Atomic)

```
User submits job creation request
        ↓
START TRANSACTION
  ├─ INSERT INTO jobs (...) → job_id: 550e8400
  ├─ INSERT INTO outbox_events (
        aggregateId: 550e8400,
        eventType: 'JOB_CREATED',
        payload: {...},
        published: false
      )
COMMIT TRANSACTION
        ↓
Both inserts succeed or both roll back (no partial state!)
```

**Key insight**: Event is stored in the database, not sent to the queue. It's marked as `published: false`.

### Phase 2: Event Publishing (Asynchronous)

```
Background process runs every 5 seconds:

1. Query DB: SELECT * FROM outbox_events WHERE published = false
2. For each unpublished event:
   a. Log event (stub: would send to message queue)
   b. UPDATE outbox_events SET published = true WHERE id = ...
3. Sleep 5 seconds
4. Repeat
```

## Example: Before & After Crash

### Scenario: Server crashes during event publishing

```
Timeline:
  10:00:00 - User creates job
  10:00:00 - Job & event saved to DB ✓
  10:00:05 - Poller wakes up, finds unpublished event
  10:00:05 - Event logged to queue ✓
  10:00:05 - SERVER CRASHES 💥
  
WITHOUT OUTBOX:
  Event was in memory, never persisted
  Next startup: Event lost forever
  Result: Job exists, but downstream systems never knew
  
WITH OUTBOX:
  Event still in DB with published=false
  Next startup: Poller restarts
  Poller finds unpublished event, logs it again
  Event gets published on retry
  Result: All systems eventually consistent ✓
```

## State Transitions

```
Event in DB states:
┌──────────────────────────────────────┐
│ published = false (unpublished)       │
│ Waiting to be sent to queue           │
└───────────┬──────────────────────────┘
            │ Poller publishes
            ▼
┌──────────────────────────────────────┐
│ published = true (published)          │
│ Event sent to queue successfully      │
└──────────────────────────────────────┘

If poller crashes while updating published flag:
  Published = false still
  Next cycle tries again
  No duplicate sends (idempotent operation)
```

## Visualizing the Database

```
OUTBOX_EVENTS table:

id                | aggregateId       | eventType    | payload | published | createdAt
────────────────────────────────────────────────────────────────────────────────────
550e8400-001     | 550e8400-job1    | JOB_CREATED  | {...}   | false     | 10:00:00
550e8400-002     | 550e8400-job1    | JOB_STARTED  | {...}   | false     | 10:00:15
550e8400-003     | 550e8400-job2    | JOB_CREATED  | {...}   | true      | 09:55:00
```

Poller will process rows with `published = false`:
- Row 1 (not yet published)
- Row 2 (not yet published)

Row 3 is already published, skip it.

## Why 5 Second Polling?

| Polling Interval | Latency | CPU Load | DB Queries/min |
|─────────────────|---------|----------|──────────────--|
| 1 second        | ~0.5s   | High     | 60             |
| **5 seconds**   | **~2.5s** | **Medium** | **12**         |
| 30 seconds      | ~15s    | Low      | 2              |
| 60 seconds      | ~30s    | Very Low | 1              |

**Why not 1 second?**
- Wastes resources querying 60x per minute
- For job service, events aren't critical milliseconds

**Why not 30 seconds?**
- Job event latency becomes noticeable
- User creates job → visible update delayed 30s

**5 seconds is the sweet spot:**
- Events published within 5 seconds (acceptable UX)
- Reasonable resource usage
- Good resilience to failures
- Can scale to millions of jobs

## Configurable Polling

To change polling interval, edit `src/index.ts`:

```typescript
// Currently 5 seconds
setInterval(async () => {
  await jobService.publishOutboxEvents();
}, 5000);  // ← Change this number (milliseconds)

// For production with high throughput, might use:
// 2000  (2 seconds)  - more aggressive
// 10000 (10 seconds) - more relaxed
```

## Guarantees Provided

### 1. **Atomicity**
Job and event always saved together, never partially.

### 2. **No Event Loss**
If system crashes, events are in DB waiting to be republished.

### 3. **At-Least-Once Delivery**
Events are published at least once. Consumers should be idempotent.

```typescript
// Consumer example (idempotent):
async function handleJobCreated(event) {
  // Check if we already processed this event
  const existing = await eventLog.findOne({ eventId: event.id });
  
  if (existing) {
    // Already processed, skip
    return;
  }
  
  // Process event
  await notificationService.sendEmail(event.jobId);
  
  // Record that we processed it
  await eventLog.create({ eventId: event.id });
}
```

## Real-World Scenario

```
10:00:00 - User creates job via API
├─ INSERT Job (id: JOB-123)
├─ INSERT OutboxEvent (id: EV-001, jobId: JOB-123, type: JOB_CREATED)
├─ COMMIT ✓

10:00:05 - Poller runs
├─ SELECT * FROM outbox_events WHERE published = false
│  ├─ Finds EV-001
├─ Log event: JOB_CREATED for JOB-123
├─ UPDATE outbox_events SET published = true WHERE id = EV-001
├─ COMMIT ✓

10:00:10 - Scheduler polls for QUEUED jobs
├─ Sees JOB-123
├─ Transitions to RUNNING
├─ INSERT OutboxEvent (id: EV-002, type: JOB_STARTED)

10:00:15 - Poller runs
├─ Finds EV-002 (unpublished)
├─ Log event: JOB_STARTED
├─ Mark as published

10:00:20 - Worker finishes job
├─ Calls internal endpoint to mark COMPLETED
├─ INSERT OutboxEvent (id: EV-003, type: JOB_COMPLETED)

10:00:25 - Poller runs
├─ Finds EV-003
├─ Log event: JOB_COMPLETED
├─ All downstream systems eventually know job is done ✓
```

## Implementation Notes for Extensions

When replacing stub with real queue (RabbitMQ, Kafka, etc.):

```typescript
async function publishOutboxEvents() {
  const events = await db.outboxEvent.findMany({
    where: { published: false },
    orderBy: { createdAt: 'asc' },
    take: 100
  });

  for (const event of events) {
    try {
      // Send to actual queue
      await rabbitmq.publish(event.eventType, event.payload);
      
      // Only mark as published after successful publish
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { published: true }
      });
    } catch (error) {
      // Don't mark as published
      // Will retry on next cycle
      logger.error({ eventId: event.id }, 'Failed to publish');
    }
  }
}
```

## Summary

| Aspect | Without Outbox | With Outbox |
|--------|────────────────|──────────────---|
| Event Loss Risk | High (in-memory) | None (in DB) |
| Consistency | Eventual ❌ | Strong ✓ |
| Crash Recovery | Manual ❌ | Automatic ✓ |
| Implementation | Simple ❌ | Slightly complex ✓ |
| Production Ready | No ❌ | Yes ✓ |

**The Outbox Pattern is essential for building resilient, production-grade systems.**
