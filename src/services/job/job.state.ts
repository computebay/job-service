import { JobStatus } from "@prisma/client";

export class InvalidStateTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid state transition from ${from} to ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Pure function that validates state transitions
 * Does not mutate any state, only validates rules
 */
export function validateStateTransition(
  currentStatus: JobStatus,
  newStatus: JobStatus
): void {
  const validTransitions: Record<JobStatus, JobStatus[]> = {
    QUEUED: [JobStatus.RUNNING, JobStatus.CANCELLED],
    RUNNING: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
  };

  const allowed = validTransitions[currentStatus];

  if (!allowed || !allowed.includes(newStatus)) {
    throw new InvalidStateTransitionError(currentStatus, newStatus);
  }
}

/**
 * Get event type based on status transition
 */
export function getEventType(fromStatus: JobStatus, toStatus: JobStatus): string {
  const eventMap: Record<string, string> = {
    [`${JobStatus.QUEUED}→${JobStatus.RUNNING}`]: "JOB_STARTED",
    [`${JobStatus.RUNNING}→${JobStatus.COMPLETED}`]: "JOB_COMPLETED",
    [`${JobStatus.RUNNING}→${JobStatus.FAILED}`]: "JOB_FAILED",
    [`${JobStatus.QUEUED}→${JobStatus.CANCELLED}`]: "JOB_CANCELLED",
    [`${JobStatus.RUNNING}→${JobStatus.CANCELLED}`]: "JOB_CANCELLED",
  };

  return eventMap[`${fromStatus}→${toStatus}`] || "JOB_STATE_CHANGED";
}
