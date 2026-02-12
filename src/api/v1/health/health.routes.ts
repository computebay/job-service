import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      status: "ok",
      service: "job-service",
      timestamp: new Date().toISOString(),
    };
  });
}
