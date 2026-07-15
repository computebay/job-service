import { JobRepository } from "./job.repository";
import {
  validateStateTransition,
  getEventType,
  InvalidStateTransitionError,
} from "./job.state";
import { CreateJobInput } from "@/types/job.types";
import { JobStatus } from "@prisma/client";
import { getLogger, instrumentedPublish } from "@computebay/observability";
import { getChannel, getExchangeName } from "@/config/rabbitmq";

const logger = getLogger();

export class JobService {
  private repository: JobRepository;

  constructor() {
    this.repository = new JobRepository();
  }

  async getExistingJobForIdempotencyKey(
    idempotencyKey: string,
    userId: string,
  ) {
    const existing = await this.repository.getIdempotencyKey(
      idempotencyKey,
      userId,
    );
    if (!existing) return null;
    return this.repository.getJobById(existing.jobId);
  }

  async createJob(
    input: CreateJobInput,
    userId: string,
    orgId: string,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const existing = await this.repository.getIdempotencyKey(
        idempotencyKey,
        userId,
      );
      if (existing) {
        logger.info(
          { jobId: existing.jobId, idempotencyKey },
          "Idempotent job creation - returning existing job",
        );
        return this.repository.getJobById(existing.jobId);
      }
    }

    logger.info({ userId, orgId, jobType: input.jobType }, "Creating new job");

    const job = await this.repository.createJob(input, userId, orgId, [
      {
        aggregateType: "job",
        eventType: "CREATED",
        payload: {
          jobId: undefined,
          orgId: input.orgId,
          repoUrl: input.repoUrl,
          branch: input.branch ?? "main",
          runtime: input.runtime,
          startCommand: input.startCommand,
          resources: input.resources,
          jobType: input.jobType,
          priority: input.priority ?? 0,
          servicePort: input.servicePort,
          buildCommand: input.buildCommand,
          runtimeCommand: input.runtimeCommand,
        },
      },
    ]);

    if (idempotencyKey) {
      await this.repository.createIdempotencyKey(
        idempotencyKey,
        userId,
        job.id,
      );
      logger.debug({ idempotencyKey, jobId: job.id }, "Stored idempotency key");
    }

    return job;
  }

  async getJob(jobId: string) {
    return this.repository.getJobById(jobId);
  }

  async getJobs(
    userId: string,
    orgId: string,
    limit?: number,
    offset?: number,
  ) {
    return this.repository.getJobsByUserId(userId, orgId, limit, offset);
  }

  async updateJobStatus(
    jobId: string,
    newStatus: JobStatus,
    updates?: {
      startedAt?: Date;
      completedAt?: Date;
    },
  ) {
    const job = await this.repository.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    try {
      validateStateTransition(job.status, newStatus);
    } catch (error) {
      if (error instanceof InvalidStateTransitionError) {
        logger.warn({ jobId, from: job.status, to: newStatus }, error.message);
        throw error;
      }
      throw error;
    }

    logger.info(
      { jobId, from: job.status, to: newStatus },
      "Updating job status",
    );

    const eventType = getEventType(job.status, newStatus);

    const updatedJob = await this.repository.updateJobStatus(
      jobId,
      newStatus,
      updates,
      [
        {
          aggregateType: "job",
          eventType,
          payload: {
            jobId,
            previousStatus: job.status,
            newStatus,
            timestamp: new Date().toISOString(),
          },
        },
      ],
    );

    return updatedJob;
  }

  async cancelJob(jobId: string, reason?: string) {
    const job = await this.repository.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (![JobStatus.QUEUED, JobStatus.RUNNING].includes(job.status)) {
      throw new InvalidStateTransitionError(job.status, JobStatus.CANCELLED);
    }

    logger.info({ jobId, reason }, "Cancelling job");

    return this.updateJobStatus(jobId, JobStatus.CANCELLED);
  }

  async publishOutboxEvents() {
    const events = await this.repository.getUnpublishedEvents(100);

    if (events.length === 0) {
      return;
    }

    logger.info({ count: events.length }, "Publishing outbox events");

    for (const event of events) {
      const channel = getChannel();
      let exchange = getExchangeName();

      const routingKey = `job.${event.eventType.toLowerCase()}`;

      // If it's a cancellation event, route directly to the node processing it
      if (event.eventType === "CANCELLED") {
        const payload = event.payload as any;
        if (payload?.jobId) {
          const job = await this.repository.getJobById(payload.jobId);

          if (job?.assignedNodeId) {
            exchange = `node.${job.assignedNodeId}.events`;
          }
        }
      }

      const message = Buffer.from(JSON.stringify(event.payload));

      const published = instrumentedPublish(channel, {
        exchange,
        routingKey,
        service: "job-service",
      }, message);

      if (!published) {
        logger.error("Failed to publish message");
      }

      await this.repository.markEventAsPublished(event.id);
    }

    logger.info({ count: events.length }, "Finished publishing events");
  }

  async emitCancelJobEvent(jobId: string) {
    const job = await this.repository.getJobById(jobId);

    if (!job) {
      logger.error({ jobId }, "Cancel event skipped: Job not found");
      return;
    }

    await this.updateJobStatus(jobId, JobStatus.CANCELLED);
    logger.info({ jobId }, "Job status set to CANCELLED");

    if (!job.assignedNodeId) {
      logger.info({ jobId }, "Job not assigned to a node; status updated to CANCELLED without emitting event");
      return;
    }

    const channel = getChannel();
    const queue = `queue.node.${job.assignedNodeId}`;

    const payload = {
      type: "CANCEL",
      jobId,
      timestamp: new Date().toISOString(),
    };
    const message = Buffer.from(JSON.stringify(payload));

    const published = channel.publish("", queue, message, {
      persistent: true,
      contentType: "application/json",
    });

    if (!published) {
      logger.error({ jobId, queue }, "Failed to publish job cancellation payload");
    } else {
      logger.info({ jobId, queue }, "Emitted job cancellation payload straight to worker queue");
    }
  }
}

export const jobService = new JobService();
