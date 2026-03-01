import { FastifyRequest, FastifyReply } from "fastify";
import { jobService } from "../../../services/job/job.service";
import {
  createJobSchema,
  updateJobStateSchema,
  cancelJobSchema,
} from "../../../validators/job.schema";
import { AuthenticatedRequest } from "../../../types/auth";
import { CreateJobInput } from "../../../types/job.types";
import { logger } from "../../../libs/logger";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { prepareAndUploadArtifact } from "../../../libs/artifact.upload";

export class JobController {
  /**
   * Create a new job
   * POST /api/v1/jobs
   */
  static async createJob(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const authReq = request as AuthenticatedRequest;
      const userId = authReq.user.sub; // Use 'sub' from JWT
      const orgId = authReq.user.orgId;
      const idempotencyKey = request.headers["idempotency-key"] as string;

      if (!idempotencyKey) {
        reply.status(400).send({
          error: "MISSING_HEADER",
          message: "Idempotency-Key header is required",
        });
        return;
      }

      // Validate request body
      const body = createJobSchema.parse(request.body);

      logger.info(
        { userId, orgId, idempotencyKey, jobType: body.jobType },
        "Creating job",
      );

      // Idempotency: return existing job without uploading (avoids orphan artifacts on retry)
      const existingJob = await jobService.getExistingJobForIdempotencyKey(
        idempotencyKey,
        userId,
      );
      if (existingJob) {
        reply.status(200).send({
          id: existingJob.id,
          ownerUserId: existingJob.ownerUserId,
          orgId: existingJob.orgId,
          status: existingJob.status,
          priority: existingJob.priority,
          jobType: existingJob.jobType,
          runtime: existingJob.runtime,
          entrypoint: existingJob.entrypoint,
          resources: existingJob.resources,
          retryPolicy: existingJob.retryPolicy,
          inputArtifacts: existingJob.inputArtifacts,
          outputArtifacts: existingJob.outputArtifacts,
          createdAt: existingJob.createdAt.toISOString(),
          startedAt: existingJob.startedAt?.toISOString(),
          completedAt: existingJob.completedAt?.toISOString(),
        });
        return;
      }

      let inputArtifacts: Record<string, unknown>;
      let predefinedJobId: string | undefined;

      if (body.code !== undefined) {
        predefinedJobId = uuid();
        const objectKey = await prepareAndUploadArtifact(
          predefinedJobId,
          { code: body.code },
          body.entrypoint,
        );
        inputArtifacts = { objectKey };
      } else if (body.project !== undefined) {
        predefinedJobId = uuid();
        const objectKey = await prepareAndUploadArtifact(
          predefinedJobId,
          { project: body.project },
          body.entrypoint,
        );
        inputArtifacts = { objectKey };
      } else {
        inputArtifacts = body.inputArtifacts as Record<string, unknown>;
      }

      const createInput: CreateJobInput = {
        jobType: body.jobType,
        runtime: body.runtime,
        entrypoint: body.entrypoint,
        resources: body.resources,
        inputArtifacts,
        retryPolicy: body.retryPolicy ?? null,
        priority: body.priority ?? 0,
        orgId: body.orgId,
        ...(predefinedJobId && { id: predefinedJobId }),
      };

      const job = await jobService.createJob(
        createInput,
        userId,
        orgId,
        idempotencyKey,
      );

      if (!job) {
        reply.status(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to create job",
        });
        return;
      }

      reply.status(201).send({
        id: job.id,
        ownerUserId: job.ownerUserId,
        orgId: job.orgId,
        status: job.status,
        priority: job.priority,
        jobType: job.jobType,
        runtime: job.runtime,
        entrypoint: job.entrypoint,
        resources: job.resources,
        retryPolicy: job.retryPolicy,
        inputArtifacts: job.inputArtifacts,
        outputArtifacts: job.outputArtifacts,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn({ errors: error.errors }, "Validation error");
        reply.status(400).send({
          error: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: error.errors,
        });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { message: errorMessage, stack: errorStack, error: String(error) },
        "Error creating job",
      );
      reply.status(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to create job",
      });
    }
  }

  /**
   * Get job by ID
   * GET /api/v1/jobs/:id
   */
  static async getJob(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const authReq = request as AuthenticatedRequest;
      const userId = authReq.user.sub; // Use 'sub' from JWT
      const orgId = authReq.user.orgId;

      const job = await jobService.getJob(id);

      if (!job) {
        reply.status(404).send({
          error: "NOT_FOUND",
          message: "Job not found",
        });
        return;
      }

      // Verify ownership
      if (job.ownerUserId !== userId || job.orgId !== orgId) {
        reply.status(403).send({
          error: "FORBIDDEN",
          message: "You do not have access to this job",
        });
        return;
      }

      reply.send({
        id: job.id,
        ownerUserId: job.ownerUserId,
        orgId: job.orgId,
        status: job.status,
        priority: job.priority,
        jobType: job.jobType,
        runtime: job.runtime,
        entrypoint: job.entrypoint,
        resources: job.resources,
        retryPolicy: job.retryPolicy,
        inputArtifacts: job.inputArtifacts,
        outputArtifacts: job.outputArtifacts,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
      });
    } catch (error) {
      logger.error({ error }, "Error getting job");
      reply.status(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to get job",
      });
    }
  }

  /**
   * List jobs for authenticated user
   * GET /api/v1/jobs
   */
  static async listJobs(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const authReq = request as AuthenticatedRequest;
      const userId = authReq.user.sub; // Use 'sub' from JWT
      const orgId = authReq.user.orgId;

      const limit = Math.min(parseInt((request.query as any).limit) || 50, 100);
      const offset = parseInt((request.query as any).offset) || 0;

      const { jobs, total } = await jobService.getJobs(
        userId,
        orgId,
        limit,
        offset,
      );

      reply.send({
        jobs: jobs.map((job) => ({
          id: job.id,
          ownerUserId: job.ownerUserId,
          orgId: job.orgId,
          status: job.status,
          priority: job.priority,
          jobType: job.jobType,
          runtime: job.runtime,
          entrypoint: job.entrypoint,
          resources: job.resources,
          retryPolicy: job.retryPolicy,
          inputArtifacts: job.inputArtifacts,
          outputArtifacts: job.outputArtifacts,
          createdAt: job.createdAt.toISOString(),
          startedAt: job.startedAt?.toISOString(),
          completedAt: job.completedAt?.toISOString(),
        })),
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      logger.error({ error }, "Error listing jobs");
      reply.status(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to list jobs",
      });
    }
  }

  /**
   * Cancel a job
   * POST /api/v1/jobs/:id/cancel
   */
  static async cancelJob(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const authReq = request as AuthenticatedRequest;
      const userId = authReq.user.sub; // Use 'sub' from JWT
      const orgId = authReq.user.orgId;

      const job = await jobService.getJob(id);

      if (!job) {
        reply.status(404).send({
          error: "NOT_FOUND",
          message: "Job not found",
        });
        return;
      }

      // Verify ownership
      if (job.ownerUserId !== userId || job.orgId !== orgId) {
        reply.status(403).send({
          error: "FORBIDDEN",
          message: "You do not have access to this job",
        });
        return;
      }

      // Validate request body
      const body = cancelJobSchema.parse(request.body || {});

      const cancelledJob = await jobService.cancelJob(id, body.reason);

      reply.send({
        id: cancelledJob.id,
        ownerUserId: cancelledJob.ownerUserId,
        orgId: cancelledJob.orgId,
        status: cancelledJob.status,
        priority: cancelledJob.priority,
        jobType: cancelledJob.jobType,
        runtime: cancelledJob.runtime,
        entrypoint: cancelledJob.entrypoint,
        resources: cancelledJob.resources,
        retryPolicy: cancelledJob.retryPolicy,
        inputArtifacts: cancelledJob.inputArtifacts,
        outputArtifacts: cancelledJob.outputArtifacts,
        createdAt: cancelledJob.createdAt.toISOString(),
        startedAt: cancelledJob.startedAt?.toISOString(),
        completedAt: cancelledJob.completedAt?.toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn({ errors: error.errors }, "Validation error");
        reply.status(400).send({
          error: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: error.errors,
        });
        return;
      }

      if (
        error instanceof Error &&
        error.name === "InvalidStateTransitionError"
      ) {
        reply.status(409).send({
          error: "INVALID_STATE_TRANSITION",
          message: error.message,
        });
        return;
      }

      logger.error({ error }, "Error cancelling job");
      reply.status(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to cancel job",
      });
    }
  }
}
