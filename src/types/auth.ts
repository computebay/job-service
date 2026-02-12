import { FastifyRequest } from "fastify";

export interface AuthPayload {
  sub: string; // User ID (subject)
  orgId: string;
  role: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthPayload;
}
