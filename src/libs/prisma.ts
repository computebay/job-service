import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log:
        process.env.LOG_LEVEL === "debug"
          ? ["query", "info", "warn", "error"]
          : ["warn", "error"],
    });
  }
  prisma = globalForPrisma.prisma;
}

export const db = prisma;
