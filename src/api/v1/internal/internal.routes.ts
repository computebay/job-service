import { FastifyInstance } from "fastify";
import { internalMiddleware } from "../../../middlewares/internal.middleware";

import { InternalJobController } from "./internal.controller";
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
