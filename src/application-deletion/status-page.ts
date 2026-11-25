/**
 * The deletion request's status page, drawn by its own route and redrawn by the restore POST when api refuses a
 * restore (plan step 8), which is why it lives outside `src/pages` (every `.ts` there is a route).
 *
 * **It reads only the request** (`findDeletion`), so it still answers once the application is gone, and it never
 * reloads the application. A 404 is the not-found page, a 401 or 403 the existing flows and a 429 the shared 429 page; any other failure is a
 * page that says progress could not be checked, which is not a claim about the request itself. Only `Completed` is
 * worded as a deletion (`./progress.ts`). No page offers a new deletion or a resend: the request is api's, and it is
 * recoverable from api whatever the browser does.
 */
import { ForbiddenError, findDeletion, formatTimestamp, NotFoundError, TooManyRequestsError, UnauthorizedError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../auth/current-user.js";
import { forLog } from "../for-log.js";
import { deletionRestorePath, deletionStatusPath } from "./paths.js";
import { type DeletionProgress, deletionProgress } from "./progress.js";

const LIST_PATH = "/deed-polls";

const en = {
  restorableHeading: "Application deleted from view",
  awaitingRemovalHeading: "Application waiting to be permanently removed",
  inProgressHeading: "Permanent removal in progress",
  awaitingDisposalHeading: "Application waiting to be removed from the case platform",
  needsAttentionHeading: "Deletion has not completed",
  completedHeading: "Application deleted",
  unavailableHeading: "Deletion request",
  restorableFor: (date: string) => `The application has been deleted from view. A Delivery Manager can restore it until ${date}.`,
  restorableThen: "After that, it will be permanently removed with its records and documents and cannot be recovered.",
  awaitingRemoval: "The application can no longer be restored. It will be permanently removed with its records and documents.",
  inProgress: "The application can no longer be restored. Its permanent removal is in progress.",
  awaitingDisposal:
    "The application can no longer be restored. It is waiting to be removed from the case platform, which happens in an overnight run, so it can take until the next day.",
  needsAttention:
    "The deletion has not completed and needs investigation. Contact the service support team. Do not ask for this application to be deleted again.",
  CDAM_REMOVED_DOCUMENT_UNPURGED: "It is waiting for the document store team to purge documents that were removed from the application earlier.",
  completed: "The application and its records and documents have been permanently removed. A record of who deleted it and why has been kept.",
  unavailable: "The progress of this deletion request could not be checked. This does not change the request. Refresh the page to try again.",
  reasonLabel: "Reason",
  requestedLabel: "Requested",
  restorableUntilLabel: "Can be restored until",
  completedLabel: "Deleted",
  CREATED_IN_ERROR: "Created in error",
  DUPLICATE: "Duplicate application",
  restore: "Restore application",
  refresh: "Refresh",
  back: "Back to applications",
  noticeTitle: "Important",
  RESTORE_WINDOW_CLOSED: "The application has not been restored, because the time to restore it has ended.",
  CLEANUP_STARTED: "The application has not been restored, because its permanent removal has started.",
  restoreRefused: "The application has not been restored. Refresh the page to see where the deletion has got to."
};

// English content in the cy shape: awaiting translation, so `yarn welsh:check` and the translation request list it.
const cy = { ...en };

const HEADINGS = {
  restorable: "restorableHeading",
  awaitingRemoval: "awaitingRemovalHeading",
  inProgress: "inProgressHeading",
  awaitingDisposal: "awaitingDisposalHeading",
  needsAttention: "needsAttentionHeading",
  completed: "completedHeading"
} as const satisfies Record<DeletionProgress, keyof typeof en>;

export async function renderDeletionStatus(req: Request, res: Response, requestId: string, notice?: RestoreNotice): Promise<void> {
  const statusPath = deletionStatusPath(requestId);
  const content = res.locals.locale === "cy" ? cy : en;
  const shared = { en, cy, statusPath, listPath: LIST_PATH, notice: notice ? content[notice] : null };

  let request: Awaited<ReturnType<typeof findDeletion>>;
  try {
    request = await findDeletion(requestId, callerFromRequest(req));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof UnauthorizedError || error instanceof TooManyRequestsError)
      throw error;
    console.error(`application deletion status unavailable: ${forLog(error instanceof Error ? error.message : String(error))}`);
    res
      .status(503)
      .render("deed-polls/deletions/status", { ...shared, progress: "unavailable", heading: content.unavailableHeading, title: content.unavailableHeading });
    return;
  }

  const progress = deletionProgress(request.status, request.restorableUntil, new Date());
  const heading = content[HEADINGS[progress]];
  res.status(notice ? 409 : 200).render("deed-polls/deletions/status", {
    ...shared,
    progress,
    heading,
    title: heading,
    paragraphs: paragraphs(progress, request, content),
    rows: rows(progress, request, content),
    restoreHref: progress === "restorable" ? deletionRestorePath(requestId, request.caseId) : null
  });
}

function paragraphs(progress: DeletionProgress, request: DeletionRequest, content: typeof en): string[] {
  if (progress === "restorable") return [content.restorableFor(formatTimestamp(request.restorableUntil)), content.restorableThen];
  if (progress === "needsAttention") {
    return request.failure === "CDAM_REMOVED_DOCUMENT_UNPURGED" ? [content.needsAttention, content.CDAM_REMOVED_DOCUMENT_UNPURGED] : [content.needsAttention];
  }
  return [content[progress]];
}

function rows(progress: DeletionProgress, request: DeletionRequest, content: typeof en): SummaryRow[] {
  return [
    { key: content.reasonLabel, value: content[request.reason] },
    { key: content.requestedLabel, value: formatTimestamp(request.requestedAt) },
    ...(progress === "restorable" ? [{ key: content.restorableUntilLabel, value: formatTimestamp(request.restorableUntil) }] : []),
    ...(progress === "completed" ? [{ key: content.completedLabel, value: formatTimestamp(request.completedAt) }] : [])
  ];
}

type DeletionRequest = Awaited<ReturnType<typeof findDeletion>>;

interface SummaryRow {
  key: string;
  value: string;
}

/** A restore refusal's sentence, by api's code and never by api's words. */
export type RestoreNotice = "RESTORE_WINDOW_CLOSED" | "CLEANUP_STARTED" | "restoreRefused";
