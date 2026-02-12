import Fastify from "fastify";
import { config } from "./config/config";
import { logger } from "./libs/logger";
import { jobRoutes } from "./api/v1/jobs/job.routes";
import { internalRoutes } from "./api/v1/internal/internal.routes";
import { healthRoutes } from "./api/v1/health/health.routes";
import { jobService } from "./services/job/job.service";

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      ...(process.env.NODE_ENV !== "production" && {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
    },
  });

  // Register routes
  await healthRoutes(app);
  await jobRoutes(app);
  await internalRoutes(app);

  // Set up periodic outbox event publishing (every 5 seconds)
  setInterval(
    async () => {
      try {
        await jobService.publishOutboxEvents();
      } catch (error) {
        logger.error({ error }, "Error publishing outbox events");
      }
    },
    5000
  );

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ error, path: request.url }, "Unhandled error");
    reply.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });

  try {
    await app.listen({ port: config.app.port, host: config.app.host });
    logger.info(
      { port: config.app.port, host: config.app.host },
      "Job Service started"
    );
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  logger.error({ error }, "Bootstrap failed");
  process.exit(1);
});
