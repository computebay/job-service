import type { ZodSchema } from "zod";
import type { Request, Response, NextFunction } from "express";

export const validate = (schema: ZodSchema<any>) =>
    (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                sucess: false,
                message: "validation failed",
                errors: result.error.issues
            });
        }

        req.body = result.data;
        next();

    }