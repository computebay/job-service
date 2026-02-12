import { FastifyRequest } from "fastify";

export interface AuthPayload {
  userId: string;
  orgId: string;
  role: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthPayload;
}
