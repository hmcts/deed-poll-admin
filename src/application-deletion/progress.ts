import type { findDeletion } from "@hmcts/deed-poll";

/**
 * What a deletion request's status page says, decided from api's status and the restore date alone.
 *
 * Only `Completed` is a deletion: every other state is a request that is still in api's hands, and the page must say
 * so honestly. In particular a `Pending` request past its `restorableUntil` is neither restorable nor being removed
 * yet, because the cleanup worker may not be switched on (plan step 5, Steve, 2026-11-25), so it names no date and
 * claims nothing is under way. Whether Restore is offered is presentation: api decides, and refuses a late one with
 * `RESTORE_WINDOW_CLOSED`.
 */
export function deletionProgress(status: DeletionStatus, restorableUntil: Date, now: Date): DeletionProgress {
  if (status === "Pending") return now.getTime() < restorableUntil.getTime() ? "restorable" : "awaitingRemoval";
  if (status === "InProgress") return "inProgress";
  if (status === "AwaitingDisposal") return "awaitingDisposal";
  if (status === "NeedsAttention") return "needsAttention";
  return "completed";
}

export type DeletionStatus = Awaited<ReturnType<typeof findDeletion>>["status"];
export type DeletionProgress = "restorable" | "awaitingRemoval" | "inProgress" | "awaitingDisposal" | "needsAttention" | "completed";
