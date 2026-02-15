import { JobRepository } from "./job.repository";
import {
  validateStateTransition,
  getEventType,
  InvalidStateTransitionError,
} from "./job.state";
import { CreateJobInput } from "@/types/job.types";
import { JobStatus } from "@prisma/client";
import { logger } from "@/libs/logger";
import { v4 as uuid } from "uuid";
import { getChannel,getExchangeName } from "@/config/rabbitmq";
export class JobService {
  private repository: JobRepository;

  constructor() {
    this.repository = new JobRepository();
  }

  /**
   * Create a new job with idempotency support
   */
  async createJob(
    input: CreateJobInput,
    userId: string,
    orgId: string,
    idempotencyKey?: string,
  ) {
    // Check idempotency key if provided
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

    // Create job with outbox event in single transaction
    const job = await this.repository.createJob(input, userId, orgId, [
      {
        aggregateType: "job",
        eventType: "CREATED",
        payload: {
          jobId: undefined, // Will be set to job.id by createJob
          orgId:input.orgId,
          jobType: input.jobType,
          runtime: input.runtime,
          entrypoint: input.entrypoint,
          resources: input.resources,
          inputArtifacts: input.inputArtifacts,
          retryPolicy: input.retryPolicy || null,
          priority: input.priority || 0,
        },
      },
    ]);

    // Store idempotency key if provided
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

  /**
   * Get job by ID
   */
  async getJob(jobId: string) {
    return this.repository.getJobById(jobId);
  }

  /**
   * Get jobs for a user
   */
  async getJobs(
    userId: string,
    orgId: string,
    limit?: number,
    offset?: number,
  ) {
    return this.repository.getJobsByUserId(userId, orgId, limit, offset);
  }

  /**
   * Update job status with state machine validation
   */
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

    // Validate state transition
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

    // Generate outbox event
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

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string, reason?: string) {
    const job = await this.repository.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Can only cancel QUEUED or RUNNING jobs
    if (![JobStatus.QUEUED, JobStatus.RUNNING].includes(job.status)) {
      throw new InvalidStateTransitionError(job.status, JobStatus.CANCELLED);
    }

    logger.info({ jobId, reason }, "Cancelling job");

    return this.updateJobStatus(jobId, JobStatus.CANCELLED);
  }

  /**
   * Publish outbox events 
   */
  async publishOutboxEvents() {
    const events = await this.repository.getUnpublishedEvents(100);

    if (events.length === 0) {
      return;
    }

    logger.info({ count: events.length }, "Publishing outbox events");

    for (const event of events) {
      //Publish events to rabbit mq
      const channel = getChannel();
      const exchange = getExchangeName();

      const routingKey = `job.${event.eventType.toLocaleLowerCase()}`;

      const message = Buffer.from(JSON.stringify(event.payload))

      const published = channel.publish(exchange,routingKey,message,{
        persistent:true,
        contentType:"application/json",
      });

      if(!published){
        logger.error("Failed to publish message");
      }

      await this.repository.markEventAsPublished(event.id)


    }

    logger.info({ count: events.length }, "Finished publishing events");
  }
}

// Export singleton instance
export const jobService = new JobService();
