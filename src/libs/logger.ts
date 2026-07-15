import { createLogger } from "@computebay/observability";

const logger = createLogger({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "job-service",
  serviceVersion: process.env.SERVICE_VERSION ?? "1.0.0",
  environment: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? "info",
});

export { logger };
