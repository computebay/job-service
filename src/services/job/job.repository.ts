import { db } from "../../libs/prisma";
import { Job, JobStatus, OutboxEvent, Prisma } from "../../generated/prisma/client";
import { CreateJobInput } from "../../types/job.types";
import { instrumentedQuery } from "@computebay/observability";

export class JobRepository {
  async createJob(
    input: CreateJobInput,
    userId: string,
    orgId: string,
    outboxEvents: Array<{
      aggregateType: string;
      eventType: string;
      payload: Record<string, unknown>;
    }>,
  ): Promise<Job> {
    return db.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          ...(input.id && { id: input.id }),
          ownerUserId: userId,
          orgId,
          status: JobStatus.QUEUED,
          jobType: input.jobType,
          repoUrl: input.repoUrl ?? "",
          branch: input.branch ?? "main",
          runtime: input.runtime ?? "",
          startCommand: input.startCommand ?? "",
          resources: input.resources as unknown as Prisma.InputJsonValue,
          retryPolicy: (input.retryPolicy ?? null) as unknown as Prisma.InputJsonValue,
          priority: input.priority || 0,
        },
      });

      for (const event of outboxEvents) {
        event.payload.jobId = job.id;
        event.payload.createdAt = job.createdAt;
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

  async getJobById(jobId: string): Promise<Job | null> {
    return instrumentedQuery("SELECT", "jobs", "job-service", () =>
      db.job.findUnique({
        where: { id: jobId },
      }),
    );
  }

  async getJobsByUserId(
    userId: string,
    orgId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ jobs: Job[]; total: number }> {
    const [jobs, total] = await Promise.all([
      instrumentedQuery("SELECT", "jobs", "job-service", () =>
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
      ),
      instrumentedQuery("COUNT", "jobs", "job-service", () =>
        db.job.count({
          where: {
            ownerUserId: userId,
            orgId,
          },
        }),
      ),
    ]);

    return { jobs, total };
  }

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
      payload: Record<string, unknown>;
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

  async getIdempotencyKey(
    key: string,
    userId: string,
  ): Promise<{ jobId: string } | null> {
    return instrumentedQuery("SELECT", "idempotency_keys", "job-service", () =>
      db.idempotencyKey.findUnique({
        where: {
          key_ownerUserId: {
            key,
            ownerUserId: userId,
          },
        },
        select: {
          jobId: true,
        },
      }),
    );
  }

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

  async getUnpublishedEvents(limit: number = 100): Promise<OutboxEvent[]> {
    return instrumentedQuery("SELECT", "outbox_events", "job-service", () =>
      db.outboxEvent.findMany({
        where: {
          published: false,
        },
        orderBy: {
          createdAt: "asc",
        },
        take: limit,
      }),
    );
  }

  async markEventAsPublished(eventId: string): Promise<void> {
    await db.outboxEvent.update({
      where: { id: eventId },
      data: { published: true },
    });
  }
}
