export const config = {
  app: {
    port: parseInt(process.env.PORT || "3000", 10),
    host: process.env.HOST || "0.0.0.0",
    environment: process.env.NODE_ENV || "development",
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://user:password@localhost:5432/job_service",
  },
  jwt: {
    enabled: process.env.JWT_ENABLED !== "false",
  },
  internal: {
    token: process.env.INTERNAL_TOKEN || "internal-secret",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
};
