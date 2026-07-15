import { z } from "zod";

const GITHUB_HTTPS_REGEX =
  /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\/)?$/;

export const resourcesSchema = z.object({
  cpu: z.number().positive("cpu must be a positive number"),
  memoryMB: z.number().positive("memoryMB must be a positive number"),
});

const baseJobSchema = z.object({
  jobType: z.enum(["batch", "service"]),
  repoUrl: z
    .string()
    .min(1, "repoUrl is required")
    .url("repoUrl must be a valid URL")
    .refine(
      (url) => GITHUB_HTTPS_REGEX.test(url),
      "repoUrl must be an HTTPS public GitHub URL (e.g. https://github.com/owner/repo)"
    ),
  branch: z.string().min(1).optional().default("main"),
  runtime: z.string().min(1, "runtime is required"),
  startCommand: z.string().min(1, "startCommand is required"),
  resources: resourcesSchema,
  retryPolicy: z.record(z.unknown()).optional(),
  priority: z.number().int().min(0).max(10).optional().default(0),
  orgId: z.string(),
  networkEnabled: z.boolean().optional(),
  buildCommand: z.string().optional(),
  runtimeCommand: z.string().optional(),
});

const batchJobSchema = baseJobSchema.extend({
  jobType: z.literal("batch"),
  servicePort: z.number().int().positive().optional(),
});

const serviceJobSchema = baseJobSchema.extend({
  jobType: z.literal("service"),
  servicePort: z.number().int().positive("servicePort must be a positive number"),
});

export const createJobSchema = z.discriminatedUnion("jobType", [
  batchJobSchema,
  serviceJobSchema,
]);

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
