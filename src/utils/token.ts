import jwt, { JwtPayload } from "jsonwebtoken";

import { AppError } from "./error";

export const verifyToken = (token: string) => {
  try {
    const decoded = jwt.verify(token, Bun.env.JWT_ACCESS_SECRET!) as JwtPayload;

    // Runtime safety check (important)
    if (!decoded || typeof decoded !== "object" || !decoded.sub) {
      throw new AppError("Invalid token payload", 401, "INVALID_TOKEN");
    }

    return decoded ;
  } catch {
    throw new AppError("Invalid or expired token", 401, "INVALID_TOKEN");
  }
};
