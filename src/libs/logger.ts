import { createLogger } from "@computebay/observability";
import { Logger } from "pino";

const logger : Logger = createLogger({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "job-service",
  serviceVersion: process.env.SERVICE_VERSION ?? "1.0.0",
  environment: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? "info",
  lokiUrl: process.env.LOKI_URL,
});

export { logger };
