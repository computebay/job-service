import { z } from "zod";

const GITHUB_HTTPS_REGEX =
  /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\/)?$/;

export const resourcesSchema = z.object({
  cpu: z.number().positive("cpu must be a positive number"),
  memoryMB: z.number().positive("memoryMB must be a positive number"),
});

export const inputSpecSchema = z.object({
  type: z.literal("s3"),
  url: z.string().min(1, "input.url is required"),
  mountPath: z.string().min(1, "input.mountPath is required"),
});

export const outputSpecSchema = z.object({
  type: z.literal("s3"),
  uploadFrom: z.string().min(1, "output.uploadFrom is required"),
});

export const batchImageResourcesSchema = z.object({
  cpu: z.number().positive("cpu must be a positive number"),
  memoryMb: z.number().positive("memoryMb must be a positive number"),
  gpu: z.enum(["any", "none"], {
    errorMap: () => ({ message: "resources.gpu must be 'any' or 'none'" }),
  }),
});

const batchJobSchema = z.object({
  jobType: z.literal("batch"),
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
  hasArtifacts: z.boolean().optional(),
  servicePort: z.number().int().positive().optional(),
});

const serviceJobSchema = z.object({
  jobType: z.literal("service"),
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
  hasArtifacts: z.boolean().optional(),
  servicePort: z.number().int().positive("servicePort must be a positive number"),
});

const batchImageJobSchema = z.object({
  jobType: z.literal("batch-image"),
  image: z.string().min(1, "image is required for batch-image jobs"),
  command: z
    .array(z.string().min(1))
    .min(1, "command must be a non-empty array for batch-image jobs"),
  input: inputSpecSchema,
  output: outputSpecSchema,
  resources: batchImageResourcesSchema,
  retryPolicy: z.record(z.unknown()).optional(),
  priority: z.number().int().min(0).max(10).optional().default(0),
  orgId: z.string(),
  hasArtifacts: z.boolean().optional(),
});

export const createJobSchema = z.discriminatedUnion("jobType", [
  batchJobSchema,
  serviceJobSchema,
  batchImageJobSchema,
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
