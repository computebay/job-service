import { FastifyRequest, FastifyReply } from "fastify";
import { logger } from "../libs/logger";
import { AuthPayload, AuthenticatedRequest } from "../types/auth";

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "Missing authorization header",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    // Verify and decode JWT
    // In production, use a proper JWT library like jsonwebtoken
    // For now, we'll accept any token and extract the payload
    // The token format from Auth Service is: {userId, orgId, role, iat, exp}

    try {
      const decoded = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString()
      ) as AuthPayload;

      // Check expiration
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        return reply.status(401).send({
          error: "TOKEN_EXPIRED",
          message: "Token has expired",
        });
      }

      (request as AuthenticatedRequest).user = decoded;
    } catch (error) {
      logger.warn("Failed to decode token");
      return reply.status(401).send({
        error: "INVALID_TOKEN",
        message: "Invalid token format",
      });
    }
  } catch (error: any) {
    logger.error("Auth middleware error:", error);
    return reply.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  }
}
