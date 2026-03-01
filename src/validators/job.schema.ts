import { z } from "zod";

export const createJobSchema = z
  .object({
    jobType: z.string().min(1, "jobType is required"),
    runtime: z.string().min(1, "runtime is required"),
    entrypoint: z
      .array(z.string())
      .min(1, "entrypoint must have at least one element"),
    resources: z.record(z.any()),
    /** Inline code: will be zipped and uploaded to MinIO; objectKey stored in inputArtifacts */
    code: z.string().optional(),
    /** Multi-file project: path → content; will be zipped and uploaded; objectKey stored in inputArtifacts */
    project: z.record(z.string()).optional(),
    /** Pre-computed artifact (e.g. objectKey from another system). If omitted, code or project must be provided. */
    inputArtifacts: z.record(z.any()).optional(),
    retryPolicy: z.record(z.any()).optional(),
    priority: z.number().int().min(0).max(10).optional().default(0),
    orgId: z.string(),
  })
  .refine(
    (data) =>
      data.code !== undefined ||
      data.project !== undefined ||
      (data.inputArtifacts &&
        typeof data.inputArtifacts.objectKey === "string"),
    {
      message:
        "One of 'code', 'project', or 'inputArtifacts.objectKey' is required for artifact storage",
    }
  );

export const updateJobStateSchema = z.object({
  status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

export const cancelJobSchema = z.object({
  reason: z.string().optional(),
});

export type CreateJobRequest = z.infer<typeof createJobSchema>;
export type UpdateJobStateRequest = z.infer<typeof updateJobStateSchema>;
export type CancelJobRequest = z.infer<typeof cancelJobSchema>;
