/**
 * Restoring an application during its grace period (plan step 8): a confirmation, then one POST with no body.
 *
 * The GET reads nothing, and Cancel is a link, so the only write is the literal `restore` action. api decides
 * whether the request is still restorable: a 409 redraws the status page from a fresh read with this app's sentence
 * for api's code, never api's words. A 404 means the request is unknown or already restored (api deletes a restored
 * request), so a repeated restore whose first answer was lost lands here with the application visible; the page says
 * the request no longer exists and links to the application, which is why the address carries `?case=`
 * (`src/application-deletion/paths.ts`). Success is a 303 to the application with its restored banner.
 */
import { ConflictError, NotFoundError, restoreDeletion } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { deletionRestorePath, deletionStatusPath } from "../../../../application-deletion/paths.js";
import { type RestoreNotice, renderDeletionStatus } from "../../../../application-deletion/status-page.js";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { casePath } from "../../../../case-path.js";

const en = {
  title: "Restore this application?",
  heading: "Restore this application?",
  body: "The application will return to the service as it was, with nothing lost.",
  confirm: "Restore application",
  cancel: "Cancel",
  goneTitle: "This deletion request no longer exists",
  gone: "The application may already have been restored.",
  viewApplication: "View the application"
};

// English content in the cy shape: awaiting translation, so `yarn welsh:check` and the translation request list it.
const cy = { ...en };

const RESTORE_NOTICES: ReadonlySet<string> = new Set(["RESTORE_WINDOW_CLOSED", "CLEANUP_STARTED"]);

export const GET = (req: Request, res: Response) => {
  const paths = restorePaths(req);
  res.render("deed-polls/deletions/restore", { en, cy, ...paths, state: "confirm" });
};

export const POST = async (req: Request, res: Response) => {
  // Built before the write, so an unusable id is a 404 that cannot follow one.
  const paths = restorePaths(req);
  if (req.body?.action !== "restore") return res.redirect(303, paths.statusPath);

  try {
    const restored = await restoreDeletion(req.params.requestId, callerFromRequest(req));
    return res.redirect(303, `${casePath(restored.caseId)}?deletion=restored`);
  } catch (error) {
    if (error instanceof ConflictError) {
      const notice = (error.code !== null && RESTORE_NOTICES.has(error.code) ? error.code : "restoreRefused") as RestoreNotice;
      return renderDeletionStatus(req, res, req.params.requestId, notice);
    }
    if (error instanceof NotFoundError) {
      const { goneTitle } = res.locals.locale === "cy" ? cy : en;
      return res.status(404).render("deed-polls/deletions/restore", { en, cy, ...paths, state: "gone", title: goneTitle, heading: goneTitle });
    }
    throw error;
  }
};

/** Both addresses, built before anything is read or written. A missing or repeated `case` is a 404. */
function restorePaths(req: Request) {
  const caseId = req.query.case;
  if (typeof caseId !== "string") throw new NotFoundError("Restore needs one application id");
  return {
    statusPath: deletionStatusPath(req.params.requestId),
    casePath: casePath(caseId),
    actionPath: deletionRestorePath(req.params.requestId, caseId)
  };
}
