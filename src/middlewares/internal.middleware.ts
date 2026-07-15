import { FastifyRequest, FastifyReply } from "fastify";
import { getLogger } from "@computebay/observability";

const logger = getLogger();
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "internal-secret";

export async function internalMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = request.headers["x-internal-token"] as string;

    if (!token) {
      return reply.status(403).send({
        error: "FORBIDDEN",
        message: "Missing internal token",
      });
    }

    if (token !== INTERNAL_TOKEN) {
      logger.warn("Invalid internal token attempt");
      return reply.status(403).send({
        error: "FORBIDDEN",
        message: "Invalid internal token",
      });
    }
  } catch (error: any) {
    logger.error("Internal middleware error:", error);
    return reply.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  }
}
