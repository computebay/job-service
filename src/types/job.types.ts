import { JobStatus } from "@prisma/client";

export interface JobResources {
  cpu: number;
  memoryMB: number;
}

export interface CreateJobInput {
  id?: string; // optional: when provided, job is created with this id
  jobType: "batch" | "service";
  repoUrl: string;
  branch?: string;
  runtime: string;
  startCommand: string;
  resources: JobResources;
  retryPolicy?: Record<string, unknown> | null;
  priority?: number;
  orgId: string;
  servicePort?: number;
  buildCommand?: string;
  runtimeCommand?: string;
  hasArtifacts?: boolean;
}

export interface UpdateJobStateInput {
  status: JobStatus;
  startedAt?: Date;
  completedAt?: Date;
}

export interface JobResponse {
  id: string;
  ownerUserId: string;
  orgId: string;
  status: JobStatus;
  priority: number;
  jobType: string;
  repoUrl: string;
  branch: string;
  runtime: string;
  startCommand: string;
  resources: JobResources;
  retryPolicy?: Record<string, unknown>;
  outputArtifacts?: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface JobCreatedEventPayload {
  jobId: string;
  orgId: string;
  repoUrl: string;
  branch: string;
  runtime: string;
  startCommand: string;
  resources: JobResources;
  jobType: string;
  priority: number;
}

export interface OutboxEventPayload {
  aggregateType: "job";
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
