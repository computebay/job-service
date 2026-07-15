import { PrismaClient } from "../generated/prisma/client";
import { getLogger } from "@computebay/observability";

const logger = getLogger();

let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({});
  }
  prisma = globalForPrisma.prisma;
}

export const db = prisma;
logger.info("Prisma client initialized");
