/**
 * api#179's permanent document deletion, restated for the mock (`docs/DOCUMENT-DELETION.md` at api `d632cdc`,
 * `DocumentDeletionService`, `DocumentDeletionReason`, `DocumentDeletionBodies` and `DocumentDeletionRefusal`).
 *
 * Admission, replay and status in api's checking order and words. api deletes while the caller waits, so a request
 * the mock admits is `Completed` at once (200) unless a test asked for `InProgress` or `NeedsAttention` (202) through
 * `/__mock/document-deletion-outcome`. **No real remote deletion**: there is no CDAM, no CCD and no filesystem here;
 * `Completed` only drops the document from memory and writes api's case note under the requester.
 *
 * An admitted document is **fenced**, as api's is: it is gone from the case detail and its file and preview routes at
 * once, whether or not the request has completed. The request outlives it, so the status read and a replay of the same
 * admission still answer after `Completed`.
 *
 * Never modelled, because the mock holds none of it: queued emails naming a document, deed preparations and staged
 * uploads (`DOCUMENT_IN_USE`), storage state (`DOCUMENT_STORAGE_UNRESOLVED`) and shared binaries (`DOCUMENT_SHARED`).
 * A test reaches each through `refuseAdmission`, at the position api would refuse it.
 *
 * The test controls are `/__mock` routes and this module is not exported from the package index, so nothing here is
 * reachable from the deployed app.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DOCUMENT_DELETION_FAILURE, DOCUMENT_DELETION_REASON_LIMITS, type DOCUMENT_DELETION_REFUSAL_CODE, DOCUMENT_DELETION_STATUS } from "../api/wire.js";

const MAX_BODY_BYTES = 16 * 1024;
const KEY_FIELD = "Idempotency-Key";
const REASON_FIELD = "reason";
const VERSION_FIELD = "expectedDocumentVersion";
const FIELDS = new Set([REASON_FIELD, VERSION_FIELD]);
const UNKNOWN_FIELDS = "A document deletion request takes only reason and expectedDocumentVersion";
const INVALID = "The document deletion request is not valid";
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A JSON integer as written: Jackson binds `3.0` and `3e0` as a Double, which api reads as no version at all.
const JSON_INTEGER = /^-?(0|[1-9]\d*)$/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
// Java's `String.strip()`: `Character.isWhitespace` at either end, which is not JavaScript's `trim()` (that also takes
// U+00A0 and U+FEFF, which Java keeps, and keeps U+001C to U+001F, which Java strips).
const JAVA_WHITESPACE = "[\\t\\n\\u000b\\f\\r\\u001c-\\u001f \\u1680\\u2000-\\u2006\\u2008-\\u200a\\u2028\\u2029\\u205f\\u3000]";
const STRIP = new RegExp(`^${JAVA_WHITESPACE}+|${JAVA_WHITESPACE}+$`, "g");
const ENTER = "Enter why this document is being deleted";
const FORBIDDEN = "The reason for deletion must not contain line breaks, tabs or control characters";
const TOO_LONG = `The reason for deletion must be ${DOCUMENT_DELETION_REASON_LIMITS.maxLength} characters or fewer`;
const NO_SUCH_CASE = "DeedPoll not found";
const NO_SUCH_REQUEST = "Document deletion request not found";
const REFUSAL_WORDS: Record<RefusalCode, string> = {
  DOCUMENT_IN_USE: "This document is currently being used and cannot be deleted. Try again once the operation has finished.",
  DOCUMENT_CHANGED: "This document has changed since you reviewed it. Review it again before deleting it.",
  DOCUMENT_STORAGE_UNRESOLVED: "This document's storage is not yet settled, so it cannot be deleted yet. Try again later.",
  DOCUMENT_SHARED: "This document's file is also used by another document record, so it cannot be deleted.",
  APPLICATION_DELETION_PENDING: "This application is being deleted, so its documents cannot be deleted separately.",
  KEY_REUSED: "This Idempotency-Key was already used for a different document deletion request on this application."
};
// The refusals a test may force, each at api's position: the application fence before the replay, the rest after
// the version check. `DOCUMENT_CHANGED` and `KEY_REUSED` are reached by sending what api would refuse.
const FORCEABLE = ["APPLICATION_DELETION_PENDING", "DOCUMENT_STORAGE_UNRESOLVED", "DOCUMENT_SHARED", "DOCUMENT_IN_USE"] as const;
const REQUEST_CONTROL = z
  .object({ requestId: z.string(), status: z.enum(DOCUMENT_DELETION_STATUS), failure: z.enum(DOCUMENT_DELETION_FAILURE).optional() })
  .strict()
  .refine((control) => (control.status === "NeedsAttention") === (control.failure !== undefined), {
    message: "failure is required with NeedsAttention and only with it",
    path: ["failure"]
  });
const OUTCOME_CONTROL = z
  .object({
    admissionOutcome: z.enum(DOCUMENT_DELETION_STATUS).optional(),
    failure: z.enum(DOCUMENT_DELETION_FAILURE).optional(),
    loseAdmissionResponse: z.boolean().optional(),
    refuseAdmission: z.enum(FORCEABLE).optional(),
    statusReads: z.enum(["available", "unavailable"]).optional()
  })
  .strict()
  .refine((control) => control.failure === undefined || control.admissionOutcome === "NeedsAttention", {
    message: "failure is given only with a NeedsAttention admissionOutcome",
    path: ["failure"]
  })
  .refine((control) => control.admissionOutcome !== "NeedsAttention" || control.failure !== undefined, {
    message: "a NeedsAttention admissionOutcome needs its failure",
    path: ["failure"]
  });

export function createDocumentDeletions<C extends DocumentHolder>(store: DocumentDeletionStore<C>) {
  const requests = new Map<string, MockDocumentDeletion<C>>();
  let nextOutcome: Outcome = { status: "Completed", failure: null };
  let loseNextAdmission = false;
  let refuseNextAdmission: Forceable | null = null;
  let statusReadsUnavailable = false;

  return {
    reset() {
      requests.clear();
      nextOutcome = { status: "Completed", failure: null };
      loseNextAdmission = false;
      refuseNextAdmission = null;
      statusReadsUnavailable = false;
    },

    /** `POST /caseworker/cases/{id}/documents/{documentId}/deletion-requests`, after the staff role is checked. */
    admit(input: AdmissionInput): Reply {
      if (input.rawBody.length > MAX_BODY_BYTES) return failure(413, "The document deletion request is too large");
      if (!isJson(input.contentType)) return failure(415, "A document deletion request must be application/json");
      const fields = bodyFields(input.rawBody);
      if (fields === null) return failure(400, INVALID);
      if (Object.keys(fields).some((key) => !FIELDS.has(key))) return failure(400, UNKNOWN_FIELDS);
      if (input.documentId.trim() === "" || input.documentId.includes("\n")) return failure(404, noSuchDocument(input.documentId));
      const body = validate(input.key, input.documentId, fields);
      if ("errors" in body) return { status: 400, body: { error: INVALID, errors: body.errors } };

      const record = store.cases.get(input.caseId);
      if (!record) return failure(404, NO_SUCH_CASE);
      if (refuseNextAdmission === "APPLICATION_DELETION_PENDING") return refused(takeRefusal() ?? "APPLICATION_DELETION_PENDING");

      const sameKey = [...requests.values()].find((request) => request.caseId === input.caseId && request.key === body.key);
      if (sameKey) return sameKey.fingerprint === body.fingerprint ? answer(sameKey) : refused("KEY_REUSED");
      // Another key already admitted for the document: the same body is that request, keeping its requester; any
      // other body meets a document that, for everyone else, has gone.
      const sameDocument = [...requests.values()].find((request) => request.caseId === input.caseId && request.documentId === input.documentId);
      if (sameDocument) return sameDocument.fingerprint === body.fingerprint ? answer(sameDocument) : failure(404, noSuchDocument(input.documentId));

      const document = record.documents.find((candidate) => candidate.id === input.documentId);
      if (!document) return failure(404, noSuchDocument(input.documentId));
      if (document.documentVersion !== body.expectedVersion) return refused("DOCUMENT_CHANGED");
      const forced = takeRefusal();
      if (forced) return refused(forced);

      const request: MockDocumentDeletion<C> = {
        requestId: randomUUID(),
        caseId: input.caseId,
        documentId: input.documentId,
        key: body.key,
        reason: body.reason,
        fingerprint: body.fingerprint,
        requester: input.requester,
        status: "InProgress",
        failure: null,
        requestedAt: store.now(),
        completedAt: null,
        fenced: { record, document }
      };
      requests.set(request.requestId, request);
      record.documents.splice(record.documents.indexOf(document), 1);
      move(request, nextOutcome);
      nextOutcome = { status: "Completed", failure: null };
      const lose = loseNextAdmission;
      loseNextAdmission = false;
      return { ...answer(request), loseResponse: lose };
    },

    /** `GET /caseworker/cases/{id}/document-deletions/{requestId}`: the case must be open; the document need not be. */
    status(caseId: string, requestId: string): Reply {
      if (statusReadsUnavailable) return failure(503, "deed-poll-api is unavailable");
      if (!store.cases.has(caseId)) return failure(404, NO_SUCH_CASE);
      const request = CANONICAL_UUID.test(requestId) ? requests.get(requestId.toLowerCase()) : undefined;
      if (!request || request.caseId !== caseId) return failure(404, NO_SUCH_REQUEST);
      return { status: 200, body: statusBody(request) };
    },

    /** Whether the case has a request not yet `Completed`, which refuses its application deletion. */
    hasUnresolved(caseId: string): boolean {
      return [...requests.values()].some((request) => request.caseId === caseId && request.status !== "Completed");
    },

    /** `/__mock/document-deletions`: move one request on, as api's recovery sweep or an operator would. */
    control(raw: unknown): Reply {
      const parsed = REQUEST_CONTROL.safeParse(raw);
      if (!parsed.success) return failure(400, parsed.error.issues.map((issue) => issue.message).join("; "));
      const request = CANONICAL_UUID.test(parsed.data.requestId) ? requests.get(parsed.data.requestId.toLowerCase()) : undefined;
      if (!request) return failure(404, NO_SUCH_REQUEST);
      if (request.status === "Completed") return failure(409, "A Completed request is frozen");
      move(request, { status: parsed.data.status, failure: parsed.data.failure ?? null });
      return { status: 200, body: statusBody(request) };
    },

    /** `/__mock/document-deletion-outcome`: the next admission's outcome, lost response or refusal, and status reads. */
    configure(raw: unknown): Reply {
      const parsed = OUTCOME_CONTROL.safeParse(raw);
      if (!parsed.success) return failure(400, parsed.error.issues.map((issue) => issue.message).join("; "));
      const { admissionOutcome, failure: code, loseAdmissionResponse, refuseAdmission, statusReads } = parsed.data;
      if (admissionOutcome !== undefined) nextOutcome = { status: admissionOutcome, failure: code ?? null };
      if (loseAdmissionResponse !== undefined) loseNextAdmission = loseAdmissionResponse;
      if (refuseAdmission !== undefined) refuseNextAdmission = refuseAdmission;
      if (statusReads !== undefined) statusReadsUnavailable = statusReads === "unavailable";
      return {
        status: 200,
        body: { admissionOutcome: nextOutcome.status, loseAdmissionResponse: loseNextAdmission, refuseAdmission: refuseNextAdmission, statusReadsUnavailable }
      };
    }
  };

  function takeRefusal(): Forceable | null {
    const refusal = refuseNextAdmission;
    refuseNextAdmission = null;
    return refusal;
  }

  // Completion is api's `DocumentDeletionCompletion`: the document goes, and one case note under the original
  // requester names it and gives their reason. The reason is then forgotten, as api clears it from the row.
  function move(request: MockDocumentDeletion<C>, outcome: Outcome): void {
    request.status = outcome.status;
    request.failure = outcome.status === "NeedsAttention" ? outcome.failure : null;
    if (outcome.status !== "Completed" || request.fenced === null) return;
    const { record, document } = request.fenced;
    store.appendNote(record, `Document ${document.name} (${document.id}) permanently deleted. Reason: ${request.reason}`, request.requester);
    request.completedAt = store.now();
    request.reason = "";
    request.fenced = null;
  }
}

// api's `validate`: every field's refusal together, a value of the wrong JSON type read as missing, nothing coerced.
function validate(rawKey: string | string[] | undefined, documentId: string, fields: Record<string, JsonValue>): ValidBody | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const key = typeof rawKey === "string" && CANONICAL_UUID.test(rawKey) ? rawKey.toLowerCase() : null;
  if (key === null) errors.push({ field: KEY_FIELD, message: "Send a UUID Idempotency-Key with a document deletion request" });
  const reasonField = fields[REASON_FIELD];
  const reason = reasonField?.kind === "string" ? reasonField.value.replace(STRIP, "") : null;
  const reasonError = reasonRefusal(reason);
  if (reasonError) errors.push({ field: REASON_FIELD, message: reasonError });
  const versionField = fields[VERSION_FIELD];
  const version = versionField?.kind === "integer" ? versionField.value : null;
  if (version === null || version < 1) errors.push({ field: VERSION_FIELD, message: "Send the document's documentVersion, as you reviewed it" });
  if (key === null || reason === null || reasonError !== null || version === null || version < 1) return { errors };
  return { key, reason, expectedVersion: version, fingerprint: `v1\n${documentId}\n${version}\n${reason}` };
}

function reasonRefusal(reason: string | null): string | null {
  if (reason === null || reason === "") return ENTER;
  if (LONE_SURROGATE.test(reason) || [...reason].some(isForbidden)) return FORBIDDEN;
  if ([...reason].length > DOCUMENT_DELETION_REASON_LIMITS.maxLength) return TOO_LONG;
  return null;
}

// Java's `Character.isISOControl`, the line and paragraph separators, and api's bidirectional controls.
function isForbidden(character: string): boolean {
  const unit = character.charCodeAt(0);
  return (
    unit <= 0x1f ||
    (unit >= 0x7f && unit <= 0x9f) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x061c ||
    unit === 0x200e ||
    unit === 0x200f ||
    (unit >= 0x202a && unit <= 0x202e) ||
    (unit >= 0x2066 && unit <= 0x2069)
  );
}

function answer<C>(request: MockDocumentDeletion<C>): Reply {
  const body = { requestId: request.requestId, status: request.status };
  if (request.status === "Completed") return { status: 200, body };
  return { status: 202, body, location: `/caseworker/cases/${request.caseId}/document-deletions/${request.requestId}` };
}

function statusBody<C>(request: MockDocumentDeletion<C>): unknown {
  return {
    requestId: request.requestId,
    documentId: request.documentId,
    status: request.status,
    requestedAt: iso(request.requestedAt),
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

function noSuchDocument(documentId: string): string {
  return `Document ${documentId} not found`;
}

function isJson(contentType: string | undefined): boolean {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" || /^application\/[^/]+\+json$/.test(type);
}

// No body is every field's error, as api answers it; a body that is not a JSON object is not a request. Each value
// is kept with its JSON kind, read from its source text, so `3`, `3.0` and `"3"` stay three different things.
function bodyFields(raw: Buffer): Record<string, JsonValue> | null {
  const text = raw.toString("utf8");
  if (text.trim() === "") return {};
  const kinds = new Map<string, JsonValue>();
  try {
    const parsed: unknown = JSON.parse(text, function (this: unknown, key, value: unknown, context?: { source?: string }) {
      if (this !== null && typeof this === "object" && !Array.isArray(this) && key !== "") kinds.set(key, kindOf(value, context?.source));
      return value;
    });
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.keys(parsed).map((key) => [key, kinds.get(key) ?? { kind: "other" }]));
  } catch {
    return null;
  }
}

function kindOf(value: unknown, source: string | undefined): JsonValue {
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number" && source !== undefined && JSON_INTEGER.test(source) && Number.isSafeInteger(value)) return { kind: "integer", value };
  return { kind: "other" };
}

// api's zoneless `LocalDateTime`, as the rest of the mock serialises one.
function iso(value: Date | null): string | null {
  return value ? value.toISOString().replace(/Z$/, "") : null;
}

type RefusalCode = (typeof DOCUMENT_DELETION_REFUSAL_CODE)[number];
type Forceable = (typeof FORCEABLE)[number];
type JsonValue = { kind: "string"; value: string } | { kind: "integer"; value: number } | { kind: "other" };

/** What the mock's case store must offer: the live cases, its clock, and a note written as api's `NoteService` would. */
export interface DocumentDeletionStore<C> {
  cases: Map<string, C>;
  now(): Date;
  appendNote(record: C, text: string, author: string): void;
}

export interface DocumentHolder {
  documents: DeletableDocument[];
}

export interface DeletableDocument {
  id: string;
  name: string;
  documentVersion: number;
}

export interface AdmissionInput {
  caseId: string;
  documentId: string;
  key: string | string[] | undefined;
  contentType: string | undefined;
  rawBody: Buffer;
  /** The verified caller's display name, under which api writes the note. */
  requester: string;
}

export interface Reply {
  status: number;
  body: unknown;
  /** The status resource, on a 202. */
  location?: string;
  /** Admitted, then the connection dropped, so the caller cannot know which. */
  loseResponse?: boolean;
}

interface Outcome {
  status: (typeof DOCUMENT_DELETION_STATUS)[number];
  failure: (typeof DOCUMENT_DELETION_FAILURE)[number] | null;
}

interface ValidBody {
  key: string;
  reason: string;
  expectedVersion: number;
  fingerprint: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface MockDocumentDeletion<C> {
  requestId: string;
  caseId: string;
  documentId: string;
  key: string;
  /** Cleared at completion, as api clears it from the row. */
  reason: string;
  fingerprint: string;
  requester: string;
  status: (typeof DOCUMENT_DELETION_STATUS)[number];
  failure: (typeof DOCUMENT_DELETION_FAILURE)[number] | null;
  requestedAt: Date;
  completedAt: Date | null;
  /** The document while its deletion is unconfirmed, hidden from every read; `null` once `Completed` dropped it. */
  fenced: { record: C; document: DeletableDocument } | null;
}
