import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import prisma from "@/config/db";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { getPresignedUrl } from "@/libs/s3";

export async function artifactRoutes(app: FastifyInstance) {
  app.register(async (fastify) => {
    fastify.addHook("preHandler", authMiddleware);

    /**
     * List artifacts for a job
     * GET /api/v1/jobs/:id/artifacts
     */
    fastify.get<{ Params: { id: string } }>(
      "/api/v1/jobs/:id/artifacts",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { id } = request.params;
          const authReq = request as any;
          const userId = authReq.user.sub;
          const orgId = authReq.user.orgId;

          const job = await prisma.job.findUnique({ where: { id } });
          if (!job) {
            return reply.status(404).send({
              error: "NOT_FOUND",
              message: "Job not found",
            });
          }

          if (job.ownerUserId !== userId || job.orgId !== orgId) {
            return reply.status(403).send({
              error: "FORBIDDEN",
              message: "Access denied",
            });
          }

          const outputArtifacts = job.outputArtifacts as any;
          const artifacts = outputArtifacts?.artifacts ?? [];

          reply.send({
            jobId: id,
            status: job.status,
            artifacts,
            logs: outputArtifacts?.logs ?? null,
          });
        } catch (error) {
          reply.status(500).send({
            error: "INTERNAL_ERROR",
            message: "Failed to list artifacts",
          });
        }
      }
    );

    /**
     * Get download URL for a specific artifact
     * GET /api/v1/jobs/:id/artifacts/:artifactId/download
     */
    fastify.get<{ Params: { id: string; artifactId: string } }>(
      "/api/v1/jobs/:id/artifacts/:artifactId/download",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { id, artifactId } = request.params;
          const authReq = request as any;
          const userId = authReq.user.sub;
          const orgId = authReq.user.orgId;

          const job = await prisma.job.findUnique({ where: { id } });
          if (!job) {
            return reply.status(404).send({
              error: "NOT_FOUND",
              message: "Job not found",
            });
          }

          if (job.ownerUserId !== userId || job.orgId !== orgId) {
            return reply.status(403).send({
              error: "FORBIDDEN",
              message: "Access denied",
            });
          }

          const outputArtifacts = job.outputArtifacts as any;
          const artifacts = outputArtifacts?.artifacts ?? [];
          
          const artifact = artifacts.find((a: any) => a.key === artifactId || a.name === artifactId);
          if (!artifact) {
            return reply.status(404).send({
              error: "NOT_FOUND",
              message: "Artifact not found",
            });
          }

          const presignedUrl = await getPresignedUrl(artifact.key);

          reply.send({
            url: presignedUrl,
            expiresIn: 900,
            artifact: {
              name: artifact.name,
              sizeBytes: artifact.sizeBytes,
              contentType: artifact.contentType,
            },
          });
        } catch (error) {
          reply.status(500).send({
            error: "INTERNAL_ERROR",
            message: "Failed to generate download URL",
          });
        }
      }
    );

    /**
     * Get download URL for job logs
     * GET /api/v1/jobs/:id/logs/download
     */
    fastify.get<{ Params: { id: string } }>(
      "/api/v1/jobs/:id/logs/download",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { id } = request.params;
          const authReq = request as any;
          const userId = authReq.user.sub;
          const orgId = authReq.user.orgId;

          const job = await prisma.job.findUnique({ where: { id } });
          if (!job) {
            return reply.status(404).send({
              error: "NOT_FOUND",
              message: "Job not found",
            });
          }

          if (job.ownerUserId !== userId || job.orgId !== orgId) {
            return reply.status(403).send({
              error: "FORBIDDEN",
              message: "Access denied",
            });
          }

          const outputArtifacts = job.outputArtifacts as any;
          const logKey = outputArtifacts?.logs?.key;
          
          if (!logKey) {
            return reply.status(404).send({
              error: "NOT_FOUND",
              message: "Log file not available",
            });
          }

          const presignedUrl = await getPresignedUrl(logKey);

          reply.send({
            url: presignedUrl,
            expiresIn: 900,
          });
        } catch (error) {
          reply.status(500).send({
            error: "INTERNAL_ERROR",
            message: "Failed to generate log download URL",
          });
        }
      }
    );
  });
}
