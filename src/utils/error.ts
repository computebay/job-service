// src/utils/errors.ts
export class AppError extends Error {
  status: number;
  code: string;
  details?: string;
  constructor(
    message: string,
    status = 500,
    code = "INTERNAL_ERROR",
    details?: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
