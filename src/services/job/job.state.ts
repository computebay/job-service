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
  newStatus: JobStatus,
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
export function getEventType(
  fromStatus: JobStatus,
  toStatus: JobStatus,
): string {
  const eventMap: Record<string, string> = {
    [`${JobStatus.QUEUED}→${JobStatus.RUNNING}`]: "STARTED",
    [`${JobStatus.RUNNING}→${JobStatus.COMPLETED}`]: "COMPLETED",
    [`${JobStatus.RUNNING}→${JobStatus.FAILED}`]: "FAILED",
    [`${JobStatus.QUEUED}→${JobStatus.CANCELLED}`]: "CANCELLED",
    [`${JobStatus.RUNNING}→${JobStatus.CANCELLED}`]: "CANCELLED",
  };

  return eventMap[`${fromStatus}→${toStatus}`] || "STATE_CHANGED";
}
