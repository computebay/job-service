import { JobStatus } from "@prisma/client";

export interface CreateJobInput {
  id?: string; // optional: when provided (e.g. for artifact upload flow), job is created with this id
  jobType: string;
  runtime: string;
  entrypoint: string[];
  resources: Record<string, any>;
  /** Stored artifact reference; typically { objectKey: "inputs/<jobId>/bundle.zip" } */
  inputArtifacts: Record<string, any>;
  retryPolicy?: Record<string, any> | null;
  priority?: number;
  orgId: string;
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
  runtime: string;
  entrypoint: string[];
  resources: Record<string, any>;
  retryPolicy?: Record<string, any>;
  inputArtifacts: Record<string, any>;
  outputArtifacts?: Record<string, any>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface OutboxEventPayload {
  aggregateType: "job";
  aggregateId: string;
  eventType: string;
  payload: Record<string, any>;
}
