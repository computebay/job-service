import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import prisma from "@/config/db";
import { authMiddleware } from "@/middlewares/auth.middleware";
import {
  getPresignedUrl,
  getPresignedPutUrl,
  s3,
  BUCKET_NAME,
  MAX_UPLOAD_BYTES,
  buildStagingKey,
  sanitizeFilename,
} from "@/libs/s3";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

export async function artifactRoutes(app: FastifyInstance) {
  app.register(async (fastify) => {
    fastify.addHook("preHandler", authMiddleware);

    /**
     * Mint a presigned PUT URL for direct browser -> MinIO upload.
     * POST /api/v1/uploads/presign { filename, contentType?, sizeBytes? }
     * -> 201 { key, name, putUrl, expiresIn, bucket }
     *
     * Client flow: presign -> PUT putUrl (Content-Type passthrough) ->
     * POST /api/v1/jobs with input.stagingKey = key. Single click in the UI.
     */
    fastify.post(
      "/api/v1/uploads/presign",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const body = (request.body ?? {}) as {
            filename?: string;
            contentType?: string;
            sizeBytes?: number;
          };

          if (!body.filename || typeof body.filename !== "string") {
            return reply.status(400).send({
              error: "VALIDATION_ERROR",
              message: "filename is required",
            });
          }

          if (
            body.sizeBytes !== undefined &&
            (typeof body.sizeBytes !== "number" ||
              body.sizeBytes <= 0 ||
              body.sizeBytes > MAX_UPLOAD_BYTES)
          ) {
            return reply.status(400).send({
              error: "VALIDATION_ERROR",
              message: `sizeBytes must be between 1 and ${MAX_UPLOAD_BYTES}`,
            });
          }

          const name = sanitizeFilename(body.filename);
          const key = buildStagingKey(body.filename);
          const contentType = body.contentType || "application/octet-stream";
          const putUrl = await getPresignedPutUrl(key, contentType);

          return reply.status(201).send({
            key,
            name,
            putUrl,
            expiresIn: 300,
            bucket: BUCKET_NAME,
            contentType,
          });
        } catch (error) {
          request.log.error({ error }, "Failed to mint presigned upload URL");
          return reply.status(500).send({
            error: "INTERNAL_ERROR",
            message: "Failed to create upload URL",
          });
        }
      }
    );

    /**
     * Small-file fallback: upload through job-service.
     * POST /api/v1/uploads (multipart/form-data, field: file, authed)
     * -> 201 { key, name, sizeBytes, contentType }
     */
    fastify.post(
      "/api/v1/uploads",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const data = await request.file();
          if (!data) {
            return reply.status(400).send({
              error: "BAD_REQUEST",
              message: "No file uploaded",
            });
          }

          const chunks: Buffer[] = [];
          for await (const chunk of data.file) {
            chunks.push(chunk as Buffer);
            if (
              chunks.reduce((n, c) => n + c.length, 0) > MAX_UPLOAD_BYTES
            ) {
              return reply.status(400).send({
                error: "VALIDATION_ERROR",
                message: "File exceeds 500MB limit",
              });
            }
          }
          const body = Buffer.concat(chunks);

          const filename = sanitizeFilename(data.filename);
          const key = buildStagingKey(data.filename);

          await s3.send(
            new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
              Body: body,
              ContentType: data.mimetype || "application/octet-stream",
            })
          );

          return reply.status(201).send({
            key,
            name: filename,
            sizeBytes: body.length,
            contentType: data.mimetype,
          });
        } catch (error) {
          request.log.error({ error }, "Failed to upload to staging");
          return reply.status(500).send({
            error: "INTERNAL_ERROR",
            message: "Failed to upload",
          });
        }
      }
    );

    /**
     * Delete an orphaned staging object (replace/remove before job submit).
     * DELETE /api/v1/uploads?key=staging/<uuid>-<file>
     */
    fastify.delete<{ Querystring: { key: string } }>(
      "/api/v1/uploads",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { key } = request.query as { key: string };
          if (!key || !key.startsWith("staging/") || key.includes("..")) {
            return reply.status(400).send({
              error: "VALIDATION_ERROR",
              message: "Only keys under staging/ can be deleted",
            });
          }
          await s3.send(
            new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key })
          );
          return reply.send({ success: true, key });
        } catch (error) {
          request.log.error({ error }, "Failed to delete staging object");
          return reply.status(500).send({
            error: "INTERNAL_ERROR",
            message: "Failed to delete upload",
          });
        }
      }
    );

    /**
     * List artifacts for a job
     * GET /api/v1/jobs/:id/artifacts
     */
    fastify.get<{ Params: { id: string } }>(
      "/api/v1/jobs/:id/artifacts",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { id } = request.params as { id: string };
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
            artifacts: artifacts.map((a: any) => ({
              id: a.name,
              ...a,
            })),
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
     * Get download URL for a specific artifact by name
     * GET /api/v1/jobs/:id/artifacts/download?name=
     */
    fastify.get<{
      Params: { id: string };
      Querystring: { name: string };
    }>(
      "/api/v1/jobs/:id/artifacts/download",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { id } = request.params as { id: string };
          const { name } = request.query as { name: string };

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

          const artifact = artifacts.find((a: any) => a.name === name);

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
          return reply.status(500).send({
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
          const { id } = request.params as { id: string };
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
