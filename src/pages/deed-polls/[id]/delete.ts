/**
 * A Delivery Manager's confirmation in front of deleting an application (plan `20261118-dm-application-deletion.md`,
 * journey steps 2–7), gated on `DELETE_APPLICATION` in `app.ts`. api owns permission, eligibility, idempotency and
 * the audit: this page asks the two questions, binds what was reviewed, and reports api's answer honestly.
 *
 * **The key is minted when the page renders** and travels, with the application's `lastChangedOn` as reviewed, in the
 * signed `journey` control (`src/application-deletion/journey.ts`). So a double submit, a retry and a back-navigated
 * resubmit all carry the same key, and a changed reason under that key is api's `KEY_REUSED` 409, never a second
 * request. Only the literal `delete` action writes; Cancel is a link and any other body is a 303 back with no write.
 *
 * **A 202 is a request, not a deletion**: it is a 303 to the request's status page, which says what api says.
 * **An answer that never came is an unknown outcome** (`DeletionOutcomeUnknownError`): the page keeps the sealed
 * request and offers only **Check deletion request**, which replays that same POST, and never reads the case to
 * guess, because a 404 there is what an admitted deletion looks like too. A 409 is this page's sentence for api's
 * `code`, never api's prose, and offers no resubmit. A 400 redraws the form with the same key, unsealed, because
 * api admitted nothing. A forged, altered, expired or other-session journey writes nothing.
 */
import {
  buildCaseList,
  type Caller,
  ConflictError,
  DELETION_NOTE_LIMITS,
  DELETION_REASON,
  DeletionOutcomeUnknownError,
  deletionFormSchema,
  findDeedPoll,
  findProcessSettings,
  InvalidInputError,
  requestDeletion
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import {
  confirmDeletionJourney,
  type DeletionJourney,
  deletionRequestBody,
  newDeletionJourney,
  openDeletionJourney,
  sealDeletionJourney
} from "../../../application-deletion/journey.js";
import { deletionConfirmationPath, deletionStatusPath } from "../../../application-deletion/paths.js";
import { callerFromRequest } from "../../../auth/current-user.js";
import { casePath } from "../../../case-path.js";
import { forLog } from "../../../for-log.js";

const LIST_PATH = "/deed-polls";

const en = {
  title: "Are you sure you want to permanently delete this application?",
  heading: "Are you sure you want to permanently delete this application?",
  referenceLabel: "Reference",
  newForenameLabel: "New forename",
  newSurnameLabel: "New surname",
  typeLabel: "Type",
  stateLabel: "Status",
  dateReceivedLabel: "Date received",
  disappears: "The application will disappear from the service straight away.",
  restoreFor: (days: number) => `A Delivery Manager can restore it for ${days === 1 ? "1 day" : `${days} days`} after you delete it.`,
  restoreForAWhile: "A Delivery Manager can restore it for a set number of days after you delete it.",
  permanent: "After that, it will be permanently removed with its records and documents and cannot be recovered.",
  audit: "A record of who deleted it and why will be kept.",
  reasonLegend: "Why is this application being deleted?",
  CREATED_IN_ERROR: "Created in error",
  DUPLICATE: "Duplicate application",
  noteLabel: "Why are you deleting this application?",
  noteHint: (min: number, max: number) =>
    `Explain the reason in ${min} to ${max} characters, on one line. Do not include the applicant’s personal details, because this is kept in the audit trail after the application has gone.`,
  warning: "You cannot undo this once the time to restore it has ended.",
  warningIcon: "Warning",
  confirm: "Permanently delete application",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  reasonRequired: "Select why this application is being deleted",
  noteRequired: "Enter why you are deleting this application",
  noteCharacters: "Why you are deleting this application must be on one line, with no tabs or special characters",
  noteTooShort: (min: number) => `Why you are deleting this application must be ${min} characters or more`,
  noteTooLong: (max: number) => `Why you are deleting this application must be ${max} characters or fewer`,
  noteRefused: (min: number, max: number) => `Enter why you are deleting this application in ${min} to ${max} characters, on one line`,
  notAccepted: "The deletion was not requested. Check your answers and try again.",
  returnToApplication: "Return to the application",
  backToApplications: "Back to applications",
  notReadyHeading: "This application cannot be deleted at the moment",
  notReady: "The application’s details could not be checked. Nothing has been deleted. Try again later.",
  invalidHeading: "This confirmation can no longer be used",
  expiredHeading: "This confirmation has expired",
  stopped:
    "Nothing has been sent from this page. If you have already asked for this application to be deleted, check whether it is still on the service before starting again. If you cannot tell, contact the service support team.",
  unknownHeading: "We do not know whether the application has been deleted",
  unknown:
    "The service did not answer in time. Do not start another deletion of this application. Check this request using its original details. If checking keeps failing, contact the service support team.",
  check: "Check deletion request",
  staleHeading: "The application has changed",
  refusedHeading: "The application cannot be deleted",
  STALE_CONFIRMATION:
    "The application has changed since you reviewed it. Return to the application, review it again, and delete it from there if you still need to.",
  RETAINED_PERMANENTLY: "The application is marked to be kept permanently, so it cannot be deleted.",
  GAZETTE_EVIDENCE: "The application has been sent to the London Gazette, so it cannot be deleted.",
  RETAINED_DEED_PAYLOAD: "The application holds deed records that must be kept, so it cannot be deleted.",
  RETAINED_STAGED_UPLOADS: "The application has documents that must be kept, so it cannot be deleted.",
  DOCUMENT_STORAGE_UNRESOLVED: "A document on the application has not finished uploading, so it cannot be deleted yet. Try again later.",
  CCD_CREATION_UNRESOLVED: "The application has not finished being added to the case platform, so it cannot be deleted yet. Try again later.",
  EMAIL_SEND_UNRESOLVED: "An email about the application has not finished sending, so it cannot be deleted yet. Try again later.",
  KEY_REUSED:
    "This deletion has already been requested with different answers, so it has not been requested again. Check whether the application is still on the service before doing anything else.",
  CONFLICTING_REASON: "The application already has a deletion request with the other reason, so another cannot be made.",
  refused: "The application cannot be deleted. Return to the application to check its details."
};

// English content in the cy shape: awaiting translation, so `yarn welsh:check` and the translation request list it.
const cy = { ...en };

const REFUSAL_SENTENCES: ReadonlySet<string> = new Set([
  "STALE_CONFIRMATION",
  "RETAINED_PERMANENTLY",
  "GAZETTE_EVIDENCE",
  "RETAINED_DEED_PAYLOAD",
  "RETAINED_STAGED_UPLOADS",
  "DOCUMENT_STORAGE_UNRESOLVED",
  "CCD_CREATION_UNRESOLVED",
  "EMAIL_SEND_UNRESOLVED",
  "KEY_REUSED",
  "CONFLICTING_REASON"
]);

export const GET = async (req: Request, res: Response) => {
  // Built before any read, so an unusable id is the 404 it would be anyway.
  casePath(req.params.id);
  const caller = callerFromRequest(req);
  const graceRead = graceDays(caller);
  const found = await findDeedPoll(req.params.id, caller);
  const days = await graceRead;

  if (!found.lastChangedOn) {
    console.error("application deletion unavailable: the case detail carries no lastChangedOn");
    return renderStop(req, res, 503, "notReadyHeading", "notReady");
  }
  return renderForm(req, res, 200, { journey: newDeletionJourney(req.params.id, found.lastChangedOn), found, days });
};

export const POST = async (req: Request, res: Response) => {
  const applicationPath = casePath(req.params.id);
  const opened = await openDeletionJourney(req, req.params.id);
  if (opened.state !== "open") return renderStop(req, res, 400, opened.state === "expired" ? "expiredHeading" : "invalidHeading", "stopped");

  const { journey } = opened;
  const action: unknown = req.body?.action;
  // A sealed journey is a recovery: it replays exactly what it holds, and nothing posted beside it can edit that.
  if (journey.confirmed) return action === "check" ? submit(req, res, journey) : res.redirect(303, applicationPath);
  if (action !== "delete") return res.redirect(303, applicationPath);

  const content = res.locals.locale === "cy" ? cy : en;
  const parsed = deletionFormSchema(formMessages(content)).safeParse(req.body ?? {});
  if (!parsed.success) {
    const errors = Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
    return redrawForm(req, res, journey, submittedValues(req.body), errors);
  }
  return submit(req, res, confirmDeletionJourney(journey, parsed.data));
};

async function submit(req: Request, res: Response, journey: DeletionJourney) {
  const body = deletionRequestBody(journey);
  if (!body) return renderStop(req, res, 400, "invalidHeading", "stopped");
  try {
    const admitted = await requestDeletion(journey.caseId, body, journey.key, callerFromRequest(req));
    return res.redirect(303, deletionStatusPath(admitted.requestId));
  } catch (error) {
    if (error instanceof DeletionOutcomeUnknownError) {
      console.error("application deletion outcome unknown");
      return renderRecovery(req, res, journey);
    }
    if (error instanceof InvalidInputError) {
      // api admitted nothing, so the same key may carry corrected answers: the journey is unsealed, not replaced.
      const { confirmed: _confirmed, ...unsealed } = journey;
      return redrawForm(req, res, unsealed, { reason: body.reason, note: body.note }, apiFieldErrors(res, error));
    }
    if (error instanceof ConflictError) {
      const code = error.code !== null && REFUSAL_SENTENCES.has(error.code) ? (error.code as RefusalKey) : "refused";
      return renderStop(req, res, 409, code === "STALE_CONFIRMATION" ? "staleHeading" : "refusedHeading", code);
    }
    throw error;
  }
}

/** The process settings' grace period, for display only: api's `restorableUntil` on the answer is the real date. */
async function graceDays(caller: Caller): Promise<number | null> {
  try {
    return (await findProcessSettings(caller)).deletionGraceDays;
  } catch (error) {
    console.error(`deletion grace period unavailable: ${forLog(error instanceof Error ? error.message : String(error))}`);
    return null;
  }
}

/** A redraw after a refused answer reads the case again for its summary only; the journey keeps what was reviewed. */
async function redrawForm(req: Request, res: Response, journey: DeletionJourney, values: FormValues, errors: Record<string, string>) {
  const caller = callerFromRequest(req);
  const graceRead = graceDays(caller);
  const found = await findDeedPoll(req.params.id, caller);
  return renderForm(req, res, 400, { journey, found, days: await graceRead, values, errors });
}

async function renderForm(req: Request, res: Response, status: number, form: FormModel) {
  const content = res.locals.locale === "cy" ? cy : en;
  const [row] = buildCaseList([form.found]);
  const values = form.values ?? { reason: "", note: "" };
  const errors = form.errors ?? {};
  res.status(status).render("deed-polls/application-delete", {
    en,
    cy,
    state: "form",
    reference: row.reference,
    summaryRows: [
      { key: content.referenceLabel, value: row.reference },
      { key: content.newForenameLabel, value: row.newForename },
      { key: content.newSurnameLabel, value: row.newSurname },
      { key: content.typeLabel, value: row.type },
      { key: content.stateLabel, value: row.state },
      { key: content.dateReceivedLabel, value: row.dateReceived }
    ],
    restoreSentence: form.days === null ? content.restoreForAWhile : content.restoreFor(form.days),
    noteHint: content.noteHint(DELETION_NOTE_LIMITS.minLength, DELETION_NOTE_LIMITS.maxLength),
    noteMax: DELETION_NOTE_LIMITS.maxLength,
    reasonItems: DELETION_REASON.map((reason) => ({ value: reason, text: content[reason], checked: values.reason === reason })),
    values,
    errors,
    errorList: ["reason", "note"].filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` })),
    journey: await sealDeletionJourney(req, form.journey),
    actionPath: deletionConfirmationPath(req.params.id),
    applicationPath: casePath(req.params.id)
  });
}

async function renderRecovery(req: Request, res: Response, journey: DeletionJourney) {
  const content = res.locals.locale === "cy" ? cy : en;
  res.status(503).render("deed-polls/application-delete", {
    en,
    cy,
    state: "unknown",
    title: content.unknownHeading,
    heading: content.unknownHeading,
    journey: await sealDeletionJourney(req, journey),
    actionPath: deletionConfirmationPath(req.params.id),
    listPath: LIST_PATH
  });
}

function renderStop(req: Request, res: Response, status: number, headingKey: HeadingKey, sentenceKey: RefusalKey | "notReady" | "stopped") {
  const content = res.locals.locale === "cy" ? cy : en;
  res.status(status).render("deed-polls/application-delete", {
    en,
    cy,
    state: "stopped",
    title: content[headingKey],
    heading: content[headingKey],
    sentence: content[sentenceKey],
    applicationPath: casePath(req.params.id),
    listPath: LIST_PATH
  });
}

function formMessages(content: typeof en) {
  return {
    reason: content.reasonRequired,
    noteRequired: content.noteRequired,
    noteCharacters: content.noteCharacters,
    noteTooShort: content.noteTooShort(DELETION_NOTE_LIMITS.minLength),
    noteTooLong: content.noteTooLong(DELETION_NOTE_LIMITS.maxLength)
  };
}

/** What a refused form redraws: a control that was not one string is redrawn empty, never stringified. */
function submittedValues(body: unknown): FormValues {
  const posted = (body ?? {}) as Record<string, unknown>;
  return {
    reason: typeof posted.reason === "string" ? posted.reason : "",
    note: typeof posted.note === "string" ? posted.note : ""
  };
}

/** api's 400 in this page's words, never api's: its reason and note errors on their fields, anything else on the form. */
function apiFieldErrors(res: Response, error: InvalidInputError): Record<string, string> {
  const content = res.locals.locale === "cy" ? cy : en;
  const fields = new Set(error.errors.map((each) => each.field));
  const errors: Record<string, string> = {};
  if (fields.has("reason")) errors.reason = content.reasonRequired;
  if (fields.has("note")) errors.note = content.noteRefused(DELETION_NOTE_LIMITS.minLength, DELETION_NOTE_LIMITS.maxLength);
  if (!errors.reason && !errors.note) errors.reason = content.notAccepted;
  return errors;
}

type HeadingKey = "notReadyHeading" | "invalidHeading" | "expiredHeading" | "staleHeading" | "refusedHeading";
type RefusalKey =
  | "STALE_CONFIRMATION"
  | "RETAINED_PERMANENTLY"
  | "GAZETTE_EVIDENCE"
  | "RETAINED_DEED_PAYLOAD"
  | "RETAINED_STAGED_UPLOADS"
  | "DOCUMENT_STORAGE_UNRESOLVED"
  | "CCD_CREATION_UNRESOLVED"
  | "EMAIL_SEND_UNRESOLVED"
  | "KEY_REUSED"
  | "CONFLICTING_REASON"
  | "refused";

interface FormValues {
  reason: string;
  note: string;
}

interface FormModel {
  journey: DeletionJourney;
  found: Awaited<ReturnType<typeof findDeedPoll>>;
  days: number | null;
  values?: FormValues;
  errors?: Record<string, string>;
}
