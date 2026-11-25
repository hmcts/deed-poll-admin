/**
 * The deletion journey's addresses, each id encoded once through `pathSegment` (see "Redirect paths" in CLAUDE.md).
 *
 * The restore address carries the application's id as `?case=`, because api answers 404 for a request once it has
 * been restored (`docs/APPLICATION-DELETION.md`), so the request alone can no longer say which application to go
 * back to. That id only ever builds a link to the case page, which api gates as it gates any case read.
 */
import { casePath } from "../case-path.js";
import { pathSegment } from "../path-segment.js";

export const DELETIONS_PATH = "/deed-polls/deletions";

export function deletionConfirmationPath(caseId: string): string {
  return `${casePath(caseId)}/delete`;
}

export function deletionStatusPath(requestId: string): string {
  return `${DELETIONS_PATH}/${pathSegment(requestId, "Deletion request id")}`;
}

export function deletionRestorePath(requestId: string, caseId: string): string {
  return `${deletionStatusPath(requestId)}/restore?${new URLSearchParams({ case: caseId })}`;
}
