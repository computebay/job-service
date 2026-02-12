import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { jobService } from "../../../services/job/job.service";
import {
  updateJobStateSchema,
  UpdateJobStateRequest,
} from "../../../validators/job.schema";
import { internalMiddleware } from "../../../middlewares/internal.middleware";
import { logger } from "../../../libs/logger";
import { z } from "zod";

export class InternalJobController {
  /**
   * Update job state (internal only)
   * POST /api/v1/internal/jobs/:id/state
   */
  static async updateJobState(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { id } = request.params as { id: string };

      // Validate request body
      const body = updateJobStateSchema.parse(request.body);

      logger.info(
        { jobId: id, newStatus: body.status },
        "Internal: updating job state",
      );

      const updates: any = {};
      if (body.startedAt) {
        updates.startedAt = new Date(body.startedAt);
      }
      if (body.completedAt) {
        updates.completedAt = new Date(body.completedAt);
      }

      const job = await jobService.updateJobStatus(
        id,
        body.status as any,
        updates,
      );

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

      if (error instanceof Error && error.message.includes("not found")) {
        reply.status(404).send({
          error: "NOT_FOUND",
          message: error.message,
        });
        return;
      }

      logger.error({ error }, "Error updating job state");
      reply.status(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to update job state",
      });
    }
  }
}

export async function internalRoutes(app: FastifyInstance) {
  // Apply internal middleware to all internal routes
  app.register(async (fastify) => {
    fastify.addHook("preHandler", internalMiddleware);

    // Update job state
    fastify.post<{ Params: { id: string }; Body: any }>(
      "/api/v1/internal/jobs/:id/state",
      InternalJobController.updateJobState,
    );
  });
}
