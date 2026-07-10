import { FastifyInstance } from "fastify";
import { JobController } from "./job.controller";
import { authMiddleware } from "../../../middlewares/auth.middleware";
import { subscribeToJobLogs } from "@/services/log/log.service";
import prisma from "@/config/db";
import { JobStatus } from "@prisma/client";

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

    // Stream job logs via SSE
    fastify.get<{ Params: { id: string }; Querystring: { stream?: string } }>(
      "/api/v1/jobs/:id/logs",
      async (request, reply) => {
        try {
          const { id } = request.params;
          const authReq = request as any;
          const userId = authReq.user.sub;
          const orgId = authReq.user.orgId;

          const job = await prisma.job.findUnique({ where: { id } });
          if (!job) {
            return reply.status(404).send({ error: "NOT_FOUND", message: "Job not found" });
          }

          if (job.ownerUserId !== userId || job.orgId !== orgId) {
            return reply.status(403).send({ error: "FORBIDDEN", message: "Access denied" });
          }

          if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED || job.status === JobStatus.CANCELLED) {
            const output = job.outputArtifacts || "";
            const lines = (output as string).split("\n").filter((l: string) => l.length > 0);
            const logLines = lines.map((line: string) => ({
              ts: job.completedAt?.toISOString() || new Date().toISOString(),
              level: "info",
              msg: line,
            }));

            reply.raw.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "Access-Control-Allow-Origin": "*",
            });

            for (const logLine of logLines) {
              reply.raw.write(`data: ${JSON.stringify(logLine)}\n\n`);
            }
            reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            reply.raw.end();
            return;
          }

          reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });

          reply.raw.write(":ok\n\n");

          subscribeToJobLogs(id, reply);

          request.raw.on("close", () => {
            // Connection closed
          });
        } catch (error) {
          reply.status(500).send({ error: "INTERNAL_ERROR", message: "Failed to stream logs" });
        }
      },
    );

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
