/**
 * api#175's application deletion, restated for the mock (`docs/APPLICATION-DELETION.md`, "HTTP contract" and "Grace
 * period and restore", at api `576d559`).
 *
 * Admission, replay, status and restore in api's checking order and words. **No real remote deletion**: there is no
 * cleanup worker, no CDAM and no CCD here. A request stays where it is until a test moves it through the explicit
 * `/__mock/application-deletions` control, and `Completed` is the only thing that drops the case, from memory.
 *
 * An admitted case is **fenced**, as api's is: the caller hands it over, and every read and write of it then misses it
 * (it is gone from the list, the detail and every child route) until a restore hands it back. The request outlives
 * it, so the status read and a replay of the same admission still answer after `Completed`.
 *
 * The test controls are `/__mock` routes and this module is not exported from the package index, so nothing here is
 * reachable from the deployed app.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DELETION_FAILURE, DELETION_NOTE_LIMITS, DELETION_REASON, DELETION_REFUSAL_CODE, DELETION_STATUS } from "../api/wire.js";

const MAX_BODY_BYTES = 16 * 1024;
const KEY_FIELD = "Idempotency-Key";
const FIELDS = new Set(["reason", "note", "expectedLastChangedOn"]);
const UNKNOWN_FIELDS = "A deletion request takes only reason, note and expectedLastChangedOn";
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `LocalDateTime.parse`'s ISO_LOCAL_DATE_TIME: seconds and up to nine fraction digits optional, and no zone or offset.
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const DAY_MS = 86_400_000;
const NOT_FOUND = "Deletion request not found";
const REFUSAL_WORDS: Record<RefusalCode, string> = {
  STALE_CONFIRMATION: "This application has changed since you reviewed it. Review it again before deleting it.",
  RETAINED_PERMANENTLY: "This application is marked to be kept permanently and cannot be deleted.",
  GAZETTE_EVIDENCE: "This application is part of Gazette publication audit evidence and cannot be deleted.",
  RETAINED_DEED_PAYLOAD: "This application has a deed whose storage is not yet settled. Resolve its document storage outcome before deleting the application.",
  RETAINED_STAGED_UPLOADS:
    "This application has staged uploads that are not yet settled. Remove unpromoted uploads or resolve their storage outcome before deleting the application.",
  DOCUMENT_STORAGE_UNRESOLVED: "A document on this application has an upload that is not yet settled. Resolve it before deleting the application.",
  DOCUMENT_DELETION_UNRESOLVED:
    "A document on this application is being permanently deleted and that deletion has not finished. Try again once it has finished, or once it has been resolved if it needs attention.",
  CCD_CREATION_UNRESOLVED: "This application's CCD case creation has not finished or needs repair. Resolve it before deleting the application.",
  EMAIL_SEND_UNRESOLVED: "An email about this application is being sent. Try again once it has settled.",
  KEY_REUSED: "This Idempotency-Key was already used for a different deletion request on this application.",
  CONFLICTING_REASON: "This application already has a deletion request for a different reason.",
  RESTORE_WINDOW_CLOSED: "The time to restore this application has passed. It can no longer be restored.",
  CLEANUP_STARTED: "This application is already being deleted. It can no longer be restored."
};
const ADMISSION_REFUSALS = DELETION_REFUSAL_CODE.filter((code) => code !== "RESTORE_WINDOW_CLOSED" && code !== "CLEANUP_STARTED");
const REQUEST_CONTROL = z
  .object({
    requestId: z.string(),
    status: z.enum(DELETION_STATUS).optional(),
    failure: z.enum(DELETION_FAILURE).optional(),
    restoreWindow: z.enum(["closed"]).optional()
  })
  .strict()
  .refine((control) => (control.status === "NeedsAttention") === (control.failure !== undefined), {
    message: "failure is required with NeedsAttention and only with it",
    path: ["failure"]
  });
const OUTCOME_CONTROL = z
  .object({
    loseAdmissionResponse: z.boolean().optional(),
    refuseAdmission: z.enum(ADMISSION_REFUSALS).optional(),
    statusReads: z.enum(["available", "unavailable"]).optional()
  })
  .strict();

export function createApplicationDeletions<C extends DeletableCase>(store: DeletionStore<C>) {
  const requests = new Map<string, MockDeletionRequest<C>>();
  let loseNextAdmission = false;
  let refuseNextAdmission: RefusalCode | null = null;
  let statusReadsUnavailable = false;

  return {
    reset() {
      requests.clear();
      loseNextAdmission = false;
      refuseNextAdmission = null;
      statusReadsUnavailable = false;
    },

    /** `POST /caseworker/cases/{id}/deletion-requests`, after the caller's capability has been checked. */
    admit(input: AdmissionInput): Reply {
      if (input.rawBody.length > MAX_BODY_BYTES) return failure(413, "The deletion request is too large");
      if (!isJson(input.contentType)) return failure(415, "A deletion request must be application/json");
      const fields = bodyFields(input.rawBody);
      if (fields === null) return failure(400, "The deletion request is not valid");
      if (Object.keys(fields).some((key) => !FIELDS.has(key))) return failure(400, UNKNOWN_FIELDS);
      const body = validate(input.key, fields);
      if ("errors" in body) return { status: 400, body: { error: "The deletion request is not valid", errors: body.errors } };

      const existing = [...requests.values()].find((request) => request.caseId === input.caseId);
      if (existing) return replay(existing, body);

      const record = store.cases.get(input.caseId);
      if (!record) return failure(404, "DeedPoll not found");
      const refusal = takeRefusal() ?? eligibilityRefusal(record, body);
      if (refusal) return refused(refusal);

      const now = store.now();
      const request: MockDeletionRequest<C> = {
        requestId: randomUUID(),
        caseId: input.caseId,
        key: body.key,
        reason: body.reason,
        fingerprint: body.fingerprint,
        status: "Pending",
        requestedAt: now,
        restorableUntil: new Date(now.getTime() + store.graceDays() * DAY_MS),
        completedAt: null,
        failure: null,
        fenced: record
      };
      requests.set(request.requestId, request);
      store.cases.delete(input.caseId);
      const lose = loseNextAdmission;
      loseNextAdmission = false;
      return { ...admitted(request), loseResponse: lose };
    },

    /** `GET /caseworker/application-deletions/{requestId}`: the request alone, so it answers after the case is gone. */
    status(requestId: string): Reply {
      if (statusReadsUnavailable) return failure(503, "deed-poll-api is unavailable");
      const request = find(requestId);
      if (!request) return failure(404, NOT_FOUND);
      return { status: 200, body: statusBody(request) };
    },

    /** `POST /caseworker/application-deletions/{requestId}/restore`: `CLEANUP_STARTED` is checked first, as api's rule is. */
    restore(requestId: string): Reply {
      const request = find(requestId);
      if (!request) return failure(404, NOT_FOUND);
      if (request.status !== "Pending" || request.fenced === null) return refused("CLEANUP_STARTED");
      if (store.now().getTime() >= request.restorableUntil.getTime()) return refused("RESTORE_WINDOW_CLOSED");
      requests.delete(request.requestId);
      store.cases.set(request.caseId, request.fenced);
      // The restore's audit event moves the case's `lastChangedOn`, so a retry of the original admission is stale.
      store.audited(request.fenced, store.now());
      return { status: 200, body: { caseId: request.caseId, status: "Restored" } };
    },

    /** `/__mock/application-deletions`: move one request on, as the worker and Retain and Dispose would. */
    control(raw: unknown): Reply {
      const parsed = REQUEST_CONTROL.safeParse(raw);
      if (!parsed.success) return failure(400, parsed.error.issues.map((issue) => issue.message).join("; "));
      const request = find(parsed.data.requestId);
      if (!request) return failure(404, NOT_FOUND);
      const { status, failure: code, restoreWindow } = parsed.data;
      if (restoreWindow === "closed") request.restorableUntil = new Date(store.now().getTime() - 1000);
      if (status !== undefined) {
        request.status = status;
        request.failure = code ?? null;
        if (status === "Completed") {
          request.completedAt = store.now();
          // The one removal the mock makes: the fenced case is dropped from memory, never to be handed back.
          request.fenced = null;
        }
      }
      return { status: 200, body: statusBody(request) };
    },

    /** `/__mock/application-deletion-outcome`: the next admission's lost response or refusal, and status-read outages. */
    configure(raw: unknown): Reply {
      const parsed = OUTCOME_CONTROL.safeParse(raw);
      if (!parsed.success) return failure(400, parsed.error.issues.map((issue) => issue.message).join("; "));
      if (parsed.data.loseAdmissionResponse !== undefined) loseNextAdmission = parsed.data.loseAdmissionResponse;
      if (parsed.data.refuseAdmission !== undefined) refuseNextAdmission = parsed.data.refuseAdmission;
      if (parsed.data.statusReads !== undefined) statusReadsUnavailable = parsed.data.statusReads === "unavailable";
      return { status: 200, body: { loseAdmissionResponse: loseNextAdmission, refuseAdmission: refuseNextAdmission, statusReadsUnavailable } };
    }
  };

  function find(requestId: string): MockDeletionRequest<C> | undefined {
    return CANONICAL_UUID.test(requestId) ? requests.get(requestId.toLowerCase()) : undefined;
  }

  function takeRefusal(): RefusalCode | null {
    const refusal = refuseNextAdmission;
    refuseNextAdmission = null;
    return refusal;
  }

  // api's order: the stale check first, then each retention or unsettled-work refusal. Only the four the mock can
  // know are restated; the rest are reached through `refuseAdmission`.
  function eligibilityRefusal(record: C, body: ValidBody): RefusalCode | null {
    if (store.lastChangedOn(record).getTime() !== body.expectedLastChangedOnMs) return "STALE_CONFIRMATION";
    if (record.retainPermanently === true) return "RETAINED_PERMANENTLY";
    if (store.hasGazetteEvidence(record)) return "GAZETTE_EVIDENCE";
    if (store.hasUnresolvedDocumentDeletion(record)) return "DOCUMENT_DELETION_UNRESOLVED";
    return null;
  }
}

// api's `replay`: the same key is the same request only with the same body; another key for the same reason answers
// the first request, keeping its Delivery Manager and note.
function replay<C>(existing: MockDeletionRequest<C>, body: ValidBody): Reply {
  if (existing.key === body.key) return existing.fingerprint === body.fingerprint ? admitted(existing) : refused("KEY_REUSED");
  return existing.reason === body.reason ? admitted(existing) : refused("CONFLICTING_REASON");
}

function admitted<C>(request: MockDeletionRequest<C>): Reply {
  return {
    status: 202,
    body: { requestId: request.requestId, status: request.status, restorableUntil: iso(request.restorableUntil) },
    location: `/caseworker/application-deletions/${request.requestId}`
  };
}

function statusBody<C>(request: MockDeletionRequest<C>): unknown {
  return {
    requestId: request.requestId,
    caseId: request.caseId,
    reason: request.reason,
    status: request.status,
    requestedAt: iso(request.requestedAt),
    restorableUntil: iso(request.restorableUntil),
    completedAt: iso(request.completedAt),
    failure: request.status === "NeedsAttention" ? request.failure : null
  };
}

function refused(code: RefusalCode): Reply {
  return { status: 409, body: { error: REFUSAL_WORDS[code], code } };
}

function failure(status: number, error: string): Reply {
  return { status, body: { error } };
}

function isJson(contentType: string | undefined): boolean {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" || /^application\/[^/]+\+json$/.test(type);
}

// No body is three field errors, as api answers it; a body that is not a JSON object is not a deletion request.
function bodyFields(raw: Buffer): Record<string, unknown> | null {
  const text = raw.toString("utf8");
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// api's `validate`: every field's refusal together, a value of the wrong JSON type read as missing, nothing coerced.
function validate(rawKey: string | string[] | undefined, fields: Record<string, unknown>): ValidBody | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const key = typeof rawKey === "string" && CANONICAL_UUID.test(rawKey) ? rawKey.toLowerCase() : null;
  if (key === null) errors.push({ field: KEY_FIELD, message: "Send a UUID Idempotency-Key with a deletion request" });
  const reason = DELETION_REASON.find((member) => member === fields.reason);
  if (reason === undefined) errors.push({ field: "reason", message: "Choose why this application is being deleted" });
  const note = typeof fields.note === "string" ? fields.note.replace(/^ +| +$/g, "") : null;
  const noteError = noteRefusal(note);
  if (noteError) errors.push({ field: "note", message: noteError });
  const expectedLastChangedOnMs = typeof fields.expectedLastChangedOn === "string" ? localDateTimeMs(fields.expectedLastChangedOn) : null;
  if (expectedLastChangedOnMs === null) errors.push({ field: "expectedLastChangedOn", message: "Send the case's lastChangedOn, as you reviewed it" });
  if (errors.length > 0 || key === null || reason === undefined || note === null || expectedLastChangedOnMs === null) return { errors };
  return { key, reason, expectedLastChangedOnMs, fingerprint: `v1\n${reason}\n${expectedLastChangedOnMs}\n${note}` };
}

function noteRefusal(note: string | null): string | null {
  if (note === null || note === "") return "Enter why this application is being deleted";
  if (hasControlCharacter(note) || LONE_SURROGATE.test(note)) return "The reason for deletion must not contain tabs, line breaks or control characters";
  const length = [...note].length;
  if (length < DELETION_NOTE_LIMITS.minLength || length > DELETION_NOTE_LIMITS.maxLength) {
    return `The reason for deletion must be between ${DELETION_NOTE_LIMITS.minLength} and ${DELETION_NOTE_LIMITS.maxLength} characters`;
  }
  return null;
}

// Java's `Character.isISOControl`: C0, DEL and C1. A code-unit check rather than a regex of control characters.
function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const unit = character.charCodeAt(0);
    return unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f);
  });
}

// Truncated to the millisecond, the precision api stores and compares the confirmation at.
function localDateTimeMs(text: string): number | null {
  const match = LOCAL_DATE_TIME.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "0", fraction = ""] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, "0").slice(0, 3)));
  const parsed = new Date(ms);
  const valid =
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day) &&
    parsed.getUTCHours() === Number(hour) &&
    parsed.getUTCMinutes() === Number(minute) &&
    parsed.getUTCSeconds() === Number(second);
  return valid ? ms : null;
}

// api's zoneless `LocalDateTime`, as the rest of the mock serialises one.
function iso(value: Date | null): string | null {
  return value ? value.toISOString().replace(/Z$/, "") : null;
}

type RefusalCode = (typeof DELETION_REFUSAL_CODE)[number];

/** What the mock's case store must offer: the live cases, its clock and grace period, and api's derived facts. */
export interface DeletionStore<C> {
  cases: Map<string, C>;
  now(): Date;
  graceDays(): number;
  lastChangedOn(record: C): Date;
  /** Record an audited write against the case, which moves its `lastChangedOn`. */
  audited(record: C, at: Date): void;
  hasGazetteEvidence(record: C): boolean;
  /** api#179: a document deletion on the case not yet `Completed`. */
  hasUnresolvedDocumentDeletion(record: C): boolean;
}

export interface DeletableCase {
  retainPermanently?: boolean | null;
}

export interface AdmissionInput {
  caseId: string;
  key: string | string[] | undefined;
  contentType: string | undefined;
  rawBody: Buffer;
}

export interface Reply {
  status: number;
  body: unknown;
  /** The status resource, on a 202. */
  location?: string;
  /** Admitted, then the connection dropped, so the caller cannot know which. */
  loseResponse?: boolean;
}

interface ValidBody {
  key: string;
  reason: (typeof DELETION_REASON)[number];
  expectedLastChangedOnMs: number;
  fingerprint: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface MockDeletionRequest<C> {
  requestId: string;
  caseId: string;
  key: string;
  reason: (typeof DELETION_REASON)[number];
  fingerprint: string;
  status: (typeof DELETION_STATUS)[number];
  requestedAt: Date;
  restorableUntil: Date;
  completedAt: Date | null;
  failure: (typeof DELETION_FAILURE)[number] | null;
  /** The case while it is fenced; `null` once `Completed` has dropped it. */
  fenced: C | null;
}
