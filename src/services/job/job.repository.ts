import { db } from "../../libs/prisma";
import { Job, JobStatus, OutboxEvent, Prisma } from "@prisma/client";
import { CreateJobInput } from "../../types/job.types";

export class JobRepository {
  /**
   * Create a new job within a transaction
   */
  async createJob(
    input: CreateJobInput,
    userId: string,
    orgId: string,
    outboxEvents: Array<{
      aggregateType: string;
      eventType: string;
      payload: Record<string, any>;
    }>,
  ): Promise<Job> {
    return db.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          ownerUserId: userId,
          orgId,
          status: JobStatus.QUEUED,
          jobType: input.jobType,
          runtime: input.runtime,
          entrypoint: input.entrypoint,
          resources: input.resources,
          inputArtifacts: input.inputArtifacts,
          retryPolicy: input.retryPolicy || Prisma.JsonNull,
          priority: input.priority || 0,
        },
      });


      // Insert outbox events in same transaction
      for (const event of outboxEvents) {
        event.payload.jobId = job.id
        event.payload.createdAt = job.createdAt
        await tx.outboxEvent.create({
          data: {
            aggregateType: event.aggregateType,
            aggregateId: job.id,
            eventType: event.eventType,
            payload: event.payload,
            published: false,
          },
        });
      }

      return job;
    });
  }

  /**
   * Get job by ID
   */
  async getJobById(jobId: string): Promise<Job | null> {
    return db.job.findUnique({
      where: { id: jobId },
    });
  }

  /**
   * Get all jobs for a user
   */
  async getJobsByUserId(
    userId: string,
    orgId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ jobs: Job[]; total: number }> {
    const [jobs, total] = await Promise.all([
      db.job.findMany({
        where: {
          ownerUserId: userId,
          orgId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
        skip: offset,
      }),
      db.job.count({
        where: {
          ownerUserId: userId,
          orgId,
        },
      }),
    ]);

    return { jobs, total };
  }

  /**
   * Update job status within a transaction
   */
  async updateJobStatus(
    jobId: string,
    newStatus: JobStatus,
    updates?: {
      startedAt?: Date;
      completedAt?: Date;
    },
    outboxEvents?: Array<{
      aggregateType: string;
      eventType: string;
      payload: Record<string, any>;
    }>,
  ): Promise<Job> {
    return db.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id: jobId },
        data: {
          status: newStatus,
          ...(updates?.startedAt && { startedAt: updates.startedAt }),
          ...(updates?.completedAt && { completedAt: updates.completedAt }),
        },
      });

      // Insert outbox events
      if (outboxEvents && outboxEvents.length > 0) {
        for (const event of outboxEvents) {
          await tx.outboxEvent.create({
            data: {
              aggregateType: event.aggregateType,
              aggregateId: job.id,
              eventType: event.eventType,
              payload: event.payload,
              published: false,
            },
          });
        }
      }

      return job;
    });
  }

  /**
   * Create a job attempt
   */
  async createJobAttempt(
    jobId: string,
    attemptNo: number,
    reason?: string,
  ): Promise<void> {
    await db.jobAttempt.create({
      data: {
        jobId,
        attemptNo,
        reason,
      },
    });
  }

  /**
   * Check if idempotency key exists for a user
   */
  async getIdempotencyKey(
    key: string,
    userId: string,
  ): Promise<{ jobId: string } | null> {
    return db.idempotencyKey.findUnique({
      where: {
        key_ownerUserId: {
          key,
          ownerUserId: userId,
        },
      },
      select: {
        jobId: true,
      },
    });
  }

  /**
   * Create idempotency key
   */
  async createIdempotencyKey(
    key: string,
    userId: string,
    jobId: string,
  ): Promise<void> {
    await db.idempotencyKey.create({
      data: {
        key,
        ownerUserId: userId,
        jobId,
      },
    });
  }

  /**
   * Get unpublished outbox events
   */
  async getUnpublishedEvents(limit: number = 100): Promise<OutboxEvent[]> {
    return db.outboxEvent.findMany({
      where: {
        published: false,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: limit,
    });
  }

  /**
   * Mark event as published
   */
  async markEventAsPublished(eventId: string): Promise<void> {
    await db.outboxEvent.update({
      where: { id: eventId },
      data: { published: true },
    });
  }
}
