import { JobStatus } from "@prisma/client";

export interface CreateJobInput {
  // id:string;
  jobType: string;
  runtime: string;
  entrypoint: string[];
  resources: Record<string, any>;
  inputArtifacts: Record<string, any>;
  retryPolicy?: Record<string, any> | null;
  priority?: number;
  // createdAt: string;
  orgId:string;
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
