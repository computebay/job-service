import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config/config";
import { createLogger, observabilityPlugin, getMetrics, initTelemetry, loadObservabilityConfig, createMetricsServer } from "@computebay/observability";
import { jobRoutes } from "./api/v1/jobs/job.routes";
import { artifactRoutes } from "./api/v1/jobs/artifact.routes";
import { internalRoutes } from "./api/v1/internal/internal.routes";
import { healthRoutes } from "./api/v1/health/health.routes";
import { jobService } from "./services/job/job.service";
import { connectRabbitMQ } from "./config/rabbitmq";
import { UpdateJobState } from "@/api/v1/internal/internal.service";
import { initializeLogStream } from "@/services/log/log.service";

const observabilityConfig = loadObservabilityConfig({
  serviceName: "job-service",
  serviceVersion: process.env.SERVICE_VERSION ?? "1.0.0",
});

// Initialize telemetry BEFORE anything else
initTelemetry(observabilityConfig);

const logger = createLogger(observabilityConfig);

async function bootstrap() {
  // Start metrics server on separate port
  createMetricsServer(observabilityConfig);

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

  // Register observability plugin (request_id, trace context, HTTP metrics)
  await app.register(observabilityPlugin, { serviceName: "job-service" });

  // CORS
  await app.register(cors, {
    origin: config.app.corsOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Internal-Token"],
    credentials: true,
  });

  // Register routes
  await healthRoutes(app);
  await jobRoutes(app);
  await artifactRoutes(app);
  await internalRoutes(app);

  // Prometheus metrics endpoint
  app.get("/metrics", async (_, reply) => {
    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    reply.send(await getMetrics());
  });

  // Initialize rabbit mq connection
  await connectRabbitMQ();

  // Set up periodic outbox event publishing (every 5 seconds)
  setInterval(async () => {
    try {
      await jobService.publishOutboxEvents();
    } catch (error) {
      logger.error({ error }, "Error publishing outbox events");
    }
  }, 5000);

  // Initialise job update consumer
  UpdateJobState();

  // Initialize log streaming service
  initializeLogStream();

  try {
    await app.listen({ port: config.app.port, host: config.app.host });
    logger.info(
      { port: config.app.port, host: config.app.host },
      "Job Service started",
    );
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  logger.fatal({ error }, "Bootstrap failed");
  process.exit(1);
});
