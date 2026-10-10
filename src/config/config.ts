const rawCorsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";

const corsOriginList = rawCorsOrigin
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// 100.64.0.0/10 is the Tailscale / CGNAT range (100.64.x.x – 100.127.x.x).
const TAILSCALE_IPV4 = /^https?:\/\/100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}(:\d+)?$/;
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const TAILSCALE_DNS = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(ts\.net|tailscale\.com|tailscale\.net)(:\d+)?$/i;

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser / curl / server-to-server
  if (corsOriginList.includes("*")) return true;
  if (corsOriginList.includes(origin)) return true;
  // Zero-config dev convenience: localhost, Tailscale IPs, Tailscale DNS.
  // Explicit CORS_ORIGIN entries are still honoured above; this just prevents
  // the "works on localhost, breaks over Tailscale" footgun.
  if (LOCALHOST.test(origin)) return true;
  if (TAILSCALE_IPV4.test(origin)) return true;
  if (TAILSCALE_DNS.test(origin)) return true;
  return false;
}

export const config = {
  app: {
    port: parseInt(process.env.PORT || "3000", 10),
    host: process.env.HOST || "0.0.0.0",
    environment: process.env.NODE_ENV || "development",
    corsOrigin: corsOriginList,
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
