/**
 * A member of staff's confirmation in front of permanently deleting one document (plan
 * `20261125-permanent-document-deletion.md`, journey steps 2–7). Any staff user reaches it: `/deed-polls/**` is gated on
 * `staff` in `app.ts`, and there is deliberately no capability gate here. api owns permission, the active-use and
 * storage checks, the version check, idempotency, the audit event and the case note; this page asks for the reason,
 * binds what was reviewed and reports api's answer.
 *
 * **The key is minted when the page renders** and travels, with the document's `documentVersion` as reviewed, in the
 * signed `journey` control (`src/document-deletion/journey.ts`), so a double submit, a retry and a back-navigated
 * resubmit all carry the same key. Only the literal `delete` action writes; Cancel is a link and any other body is a
 * 303 back to the Documents tab with no write.
 *
 * api deletes while the caller waits: a `Completed` answer is a 303 to the Documents tab with its banner, anything else
 * a 303 to the request's progress page. **An answer that never came is an unknown outcome**: the page keeps the sealed
 * request and offers only **Check deletion request**, which replays that same POST, and never reads the document to
 * guess, because a 404 there is what a completed deletion looks like too. A 400 or a 409 is a definite refusal: api
 * admitted nothing, so the form is redrawn with the reason as sent and the same key (`afterDefiniteRefusal`), except
 * after `DOCUMENT_CHANGED` or `KEY_REUSED`, which need a fresh review. Each 409 is this page's sentence for api's
 * `code`, never api's prose.
 */
import {
  buildDocumentsView,
  type Caller,
  ConflictError,
  DOCUMENT_DELETION_REASON_LIMITS,
  DocumentDeletionOutcomeUnknownError,
  documentDeletionFormSchema,
  findDeedPoll,
  InvalidInputError,
  NotFoundError,
  requestDocumentDeletion,
  UnauthorizedError
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import {
  afterDefiniteRefusal,
  type ConfirmedDocumentDeletionJourney,
  confirmDocumentDeletionJourney,
  type DocumentDeletionJourney,
  documentDeletionRequestBody,
  isConfirmedDocumentDeletionJourney,
  newDocumentDeletionJourney,
  openDocumentDeletionJourney,
  sealDocumentDeletionJourney
} from "../../../../../document-deletion/journey.js";
import {
  caseDocumentsPath,
  documentDeletedPath,
  documentDeletionConfirmationPath,
  documentDeletionStatusPath
} from "../../../../../document-deletion/paths.js";
import { caseViewerScope, documentPaths } from "../../../../../document-viewer/context.js";
import { forLog } from "../../../../../for-log.js";

const VIEW = "deed-polls/document-delete";

const en = {
  title: "Are you sure you want to permanently delete this document?",
  heading: "Are you sure you want to permanently delete this document?",
  referenceLabel: "Application reference",
  documentLabel: "Document",
  typeLabel: "Type",
  addedLabel: "Added",
  viewDocument: "View the document",
  reasonLabel: "Why are you deleting this document?",
  reasonHint: "For example, uploaded in error. Do not include unnecessary personal information.",
  warning: "This will permanently delete the document. You cannot undo this. The reason will be recorded in the audit trail and as a case note.",
  warningIcon: "Warning",
  confirm: "Permanently delete document",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  reasonRequired: "Enter why you are deleting this document",
  reasonCharacters: "Why you are deleting this document must be on one line, with no tabs or special characters",
  reasonTooLong: (max: number) => `Why you are deleting this document must be ${max} characters or fewer`,
  reasonRefused: (max: number) => `Enter why you are deleting this document in ${max} characters or fewer, on one line`,
  notAccepted: "The document was not deleted. Check your answer and try again.",
  DOCUMENT_IN_USE: "This document is currently being used and cannot be deleted. Try again once the operation has finished.",
  DOCUMENT_STORAGE_UNRESOLVED: "This document has not finished being stored, so it cannot be deleted yet. Try again later.",
  DOCUMENT_SHARED: "This document’s file is also used by another document on the service, so it cannot be deleted. Contact the service support team.",
  APPLICATION_DELETION_PENDING: "This application is being deleted, so its documents cannot be deleted separately.",
  refused: "The document was not deleted. Check the document’s details and try again.",
  returnToDocuments: "Return to the application’s documents",
  staleHeading: "The document has changed",
  DOCUMENT_CHANGED:
    "The document has changed since you reviewed it, so it has not been deleted. Return to the application’s documents, check the document again, and delete it from there if you still need to.",
  keyReusedHeading: "The document cannot be deleted from this page",
  KEY_REUSED:
    "This deletion has already been requested with a different reason, so it has not been requested again. Check whether the document is still on the application before doing anything else.",
  invalidHeading: "This confirmation can no longer be used",
  expiredHeading: "This confirmation has expired",
  stopped: "Nothing has been sent from this page. Return to the application’s documents and start again from the document if you still need to delete it.",
  recoveryStopped:
    "This deletion request can no longer be checked from this page, so we still do not know whether the document has been deleted. Do not start another deletion of this document. Contact the service support team.",
  unknownHeading: "We do not know whether the document has been deleted",
  unknown:
    "The service did not answer in time. Do not start another deletion of this document. Check this request using its original details. If checking keeps failing, contact the service support team.",
  check: "Check deletion request"
};

// English content in the cy shape: awaiting translation, so `yarn welsh:check` and the translation request list it.
const cy = { ...en };

// The admission's refusal codes this page has a sentence for; `delete.test.ts` pins them to api's vocabulary.
const REFUSAL_CODES = [
  "DOCUMENT_IN_USE",
  "DOCUMENT_CHANGED",
  "DOCUMENT_STORAGE_UNRESOLVED",
  "DOCUMENT_SHARED",
  "APPLICATION_DELETION_PENDING",
  "KEY_REUSED"
] as const;

export const GET = async (req: Request, res: Response) => {
  const { id, documentId } = req.params;
  // Built before any read, so an unusable id is the 404 it would be anyway.
  documentDeletionConfirmationPath(id, documentId);

  const found = await findDeedPoll(id, callerFromRequest(req));
  const document = found.documents.find((each) => each.id === documentId);
  if (!document) throw new NotFoundError("Document not found on this case");

  return renderForm(req, res, 200, {
    journey: newDocumentDeletionJourney(id, documentId, document.documentVersion),
    summary: summaryFrom(found, documentId)
  });
};

export const POST = async (req: Request, res: Response) => {
  const { id, documentId } = req.params;
  const documentsPath = caseDocumentsPath(id);
  documentDeletionConfirmationPath(id, documentId);
  const action: unknown = req.body?.action;
  const opened = await openDocumentDeletionJourney(req, id, documentId);
  // Only the recovery form posts `check`, and its request may already have been admitted, so "nothing was sent" is false.
  if (opened.state !== "open") {
    return renderStop(req, res, 400, opened.state === "expired" ? "expiredHeading" : "invalidHeading", action === "check" ? "recoveryStopped" : "stopped");
  }

  const { journey } = opened;
  // A sealed journey is a recovery: it replays exactly what it holds, and nothing posted beside it can edit that.
  if (isConfirmedDocumentDeletionJourney(journey)) return action === "check" ? submit(req, res, journey) : res.redirect(303, documentsPath);
  if (action !== "delete") return res.redirect(303, documentsPath);

  const content = contentFor(res);
  const parsed = documentDeletionFormSchema(formMessages(content)).safeParse(req.body ?? {});
  if (!parsed.success) {
    return redrawForm(req, res, 400, journey, submittedReason(req.body), { reason: parsed.error.issues[0].message });
  }
  return submit(req, res, confirmDocumentDeletionJourney(journey, parsed.data));
};

async function submit(req: Request, res: Response, journey: ConfirmedDocumentDeletionJourney) {
  try {
    const admitted = await requestDocumentDeletion(
      journey.caseId,
      journey.documentId,
      documentDeletionRequestBody(journey),
      journey.key,
      callerFromRequest(req)
    );
    return res.redirect(
      303,
      admitted.status === "Completed" ? documentDeletedPath(journey.caseId) : documentDeletionStatusPath(journey.caseId, admitted.requestId)
    );
  } catch (error) {
    if (error instanceof DocumentDeletionOutcomeUnknownError) {
      console.error("document deletion outcome unknown");
      return renderRecovery(req, res, journey);
    }
    if (error instanceof InvalidInputError) {
      const next = afterDefiniteRefusal(journey);
      if (next.next === "redraw") return redrawForm(req, res, 400, next.journey, next.reason, apiFieldErrors(res, error));
    }
    if (error instanceof ConflictError) {
      const code: RefusalKey = REFUSAL_CODES.find((each) => each === error.code) ?? "refused";
      const next = afterDefiniteRefusal(journey, code === "refused" ? null : code);
      if (next.next === "review") {
        return code === "KEY_REUSED"
          ? renderStop(req, res, 409, "keyReusedHeading", "KEY_REUSED")
          : renderStop(req, res, 409, "staleHeading", "DOCUMENT_CHANGED");
      }
      return redrawForm(req, res, 409, next.journey, next.reason, { form: contentFor(res)[code as FormRefusalKey] });
    }
    throw error;
  }
}

/**
 * A redraw after a refusal reads the case again for the summary only; the journey keeps what was reviewed. A failed
 * read, or a document no longer on the case, drops the summary rather than the reason, because nothing else needs it.
 */
async function redrawForm(req: Request, res: Response, status: number, journey: DocumentDeletionJourney, reason: string, errors: FormErrors) {
  const summary = await summaryOf(journey.caseId, journey.documentId, callerFromRequest(req));
  return renderForm(req, res, status, { journey, summary, reason, errors });
}

async function summaryOf(caseId: string, documentId: string, caller: Caller): Promise<Summary | null> {
  try {
    return summaryFrom(await findDeedPoll(caseId, caller), documentId);
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    console.error(`document deletion summary unavailable: ${forLog(error instanceof Error ? error.message : String(error))}`);
    return null;
  }
}

function summaryFrom(found: FoundCase, documentId: string): Summary | null {
  const document = found.documents.find((each) => each.id === documentId);
  if (!document) return null;
  const [row] = buildDocumentsView([document]);
  return {
    reference: found.displayReference ?? "",
    name: row.name,
    type: row.type,
    added: row.added,
    viewHref: row.downloadable ? documentPaths(caseViewerScope(found.id), document.id).viewPath : null
  };
}

async function renderForm(req: Request, res: Response, status: number, form: FormModel) {
  const content = contentFor(res);
  const errors = form.errors ?? {};
  const summary = form.summary;
  res.status(status).render(VIEW, {
    en,
    cy,
    state: "form",
    reference: summary?.reference ?? "",
    summaryRows: summary
      ? [
          { key: content.referenceLabel, value: summary.reference },
          { key: content.documentLabel, value: summary.name },
          { key: content.typeLabel, value: summary.type },
          { key: content.addedLabel, value: summary.added }
        ]
      : [],
    viewHref: summary?.viewHref ?? null,
    reason: form.reason ?? "",
    reasonMax: DOCUMENT_DELETION_REASON_LIMITS.maxLength,
    errors,
    errorList: [...(errors.form ? [{ text: errors.form }] : []), ...(errors.reason ? [{ text: errors.reason, href: "#reason" }] : [])],
    journey: await sealDocumentDeletionJourney(req, form.journey),
    actionPath: documentDeletionConfirmationPath(form.journey.caseId, form.journey.documentId),
    documentsPath: caseDocumentsPath(form.journey.caseId)
  });
}

async function renderRecovery(req: Request, res: Response, journey: DocumentDeletionJourney) {
  const content = contentFor(res);
  res.status(503).render(VIEW, {
    en,
    cy,
    state: "unknown",
    title: content.unknownHeading,
    heading: content.unknownHeading,
    journey: await sealDocumentDeletionJourney(req, journey),
    actionPath: documentDeletionConfirmationPath(journey.caseId, journey.documentId),
    documentsPath: caseDocumentsPath(journey.caseId)
  });
}

function renderStop(req: Request, res: Response, status: number, headingKey: HeadingKey, sentenceKey: StopKey) {
  const content = contentFor(res);
  res.status(status).render(VIEW, {
    en,
    cy,
    state: "stopped",
    title: content[headingKey],
    heading: content[headingKey],
    sentence: content[sentenceKey],
    documentsPath: caseDocumentsPath(req.params.id)
  });
}

function contentFor(res: Response): typeof en {
  return res.locals.locale === "cy" ? cy : en;
}

function formMessages(content: typeof en) {
  return {
    reasonRequired: content.reasonRequired,
    reasonCharacters: content.reasonCharacters,
    reasonTooLong: content.reasonTooLong(DOCUMENT_DELETION_REASON_LIMITS.maxLength)
  };
}

/** What a refused form redraws: a control that was not one string is redrawn empty, never stringified. */
function submittedReason(body: unknown): string {
  const posted = (body ?? {}) as Record<string, unknown>;
  return typeof posted.reason === "string" ? posted.reason : "";
}

/** api's 400 in this page's words, never api's: a reason error on the field, anything else on the form. */
function apiFieldErrors(res: Response, error: InvalidInputError): FormErrors {
  const content = contentFor(res);
  return error.errors.some((each) => each.field === "reason")
    ? { reason: content.reasonRefused(DOCUMENT_DELETION_REASON_LIMITS.maxLength) }
    : { form: content.notAccepted };
}

type RefusalKey = (typeof REFUSAL_CODES)[number] | "refused";
type FormRefusalKey = Exclude<RefusalKey, "DOCUMENT_CHANGED" | "KEY_REUSED">;
type HeadingKey = "invalidHeading" | "expiredHeading" | "staleHeading" | "keyReusedHeading";
type StopKey = "stopped" | "recoveryStopped" | "DOCUMENT_CHANGED" | "KEY_REUSED";
type FoundCase = Awaited<ReturnType<typeof findDeedPoll>>;

interface Summary {
  reference: string;
  name: string;
  type: string;
  added: string;
  viewHref: string | null;
}

interface FormErrors {
  reason?: string;
  form?: string;
}

interface FormModel {
  journey: DocumentDeletionJourney;
  summary: Summary | null;
  reason?: string;
  errors?: FormErrors;
}
