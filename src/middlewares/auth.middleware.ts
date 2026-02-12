import { FastifyRequest, FastifyReply } from "fastify";
import { logger } from "../libs/logger";
import { AuthPayload, AuthenticatedRequest } from "../types/auth";
import { verifyToken } from "@/utils/token";
import { Jwt, JwtPayload } from "jsonwebtoken";

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

    const token = authHeader.split(" ")[1];

    if (!token) {
      return reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "Missing auth token",
      });
    }

 

    try {
      const decoded = verifyToken(token) as JwtPayload
      
      // Validate required fields
      if (!decoded.sub || !decoded.orgId) {
        logger.warn("Token missing required fields");
        return reply.status(401).send({
          error: "INVALID_TOKEN",
          message: "Token missing required fields (sub, orgId)",
        });
      }

      (request as JwtPayload).user = decoded;
    } catch (error) {
      logger.warn("Failed to decode token");
      return reply.status(401).send({
        error: "INVALID_TOKEN",
        message: `Invalid token format: ${error}`,
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
