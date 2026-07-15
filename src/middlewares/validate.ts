import type { ZodSchema } from "zod";

export const validate =
  (schema: ZodSchema<any>) =>
  (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        sucess: false,
        message: "validation failed",
        errors: result.error.issues,
      });
    }

    req.body = result.data;
    next();
  };
