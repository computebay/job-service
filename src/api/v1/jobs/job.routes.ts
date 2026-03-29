import { FastifyInstance } from "fastify";
import { JobController } from "./job.controller";
import { authMiddleware } from "../../../middlewares/auth.middleware";

export async function jobRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes
  app.register(async (fastify) => {
    fastify.addHook("preHandler", authMiddleware);

    // Create job
    fastify.post<{ Body: any }>("/api/v1/jobs", JobController.createJob);

    // Get job
    fastify.get<{ Params: { id: string } }>(
      "/api/v1/jobs/:id",
      JobController.getJob,
    );

    // List jobs
    fastify.get("/api/v1/jobs", JobController.listJobs);

    // Cancel job
    fastify.post<{ Params: { id: string }; Body: any }>(
      "/api/v1/jobs/:id/cancel",
      JobController.cancelJob,
    );

    // Hard cancel job
    fastify.post<{ Params: { id: string } }>(
      "/api/v1/jobs/:id/hard-cancel",
      JobController.hardCancelJob,
    );
  });
}
