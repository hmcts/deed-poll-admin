/**
 * The only module in this repo that knows `deed-poll-api` exists.
 *
 * Plain functions over `fetch`, per decision 1 of `docs/plans/02-dal-cutover-to-api.md`. Everything
 * above this line deals in cases, notes, witnesses and documents; nothing above it sees a URL, an HTTP
 * status or a multipart boundary. When api's shape changes, this file changes.
 *
 * NOTHING HERE THROWS ON A FAILED CALL. Every function returns `ApiResult`, a discriminated union the
 * caller branches on, because this app is a caseworker's whole working day: an unreachable api has to be
 * a page that keeps their form, not a 500 that loses it. Only a programming error — a base URL that is
 * not a URL — throws, and that is what the error middleware is for.
 *
 * No request or response logging, deliberately: a case body is an applicant's name, address, date of
 * birth and the reason they are changing their name. The no-PII-in-logs rule has no debugging exception.
 */
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { z } from "zod";
import {
  UNSPECIFIED_SCHEMAS,
  WIRE_SCHEMAS,
  type WireCaseDetail,
  type WireCaseList,
  type WireCaseWrite,
  type WireDocument,
  type WireDocumentType,
  type WireFieldRules,
  type WireNote,
  type WireSavedCase
} from "./wire.js";

/**
 * The option-set members, re-exported because they are api's published vocabulary rather than a
 * detail of how a response is parsed.
 *
 * The rest of `wire.js` stays unexported — see the note in `../index.ts` — but these arrays are
 * plain data, pinned against the spec by `contract.test.ts`, and `libs/deed-poll` builds its
 * enum members and Dynamics label maps out of them now that Prisma's generated ones are going.
 */
export {
  DEED_POLL_STATE,
  DEED_POLL_TYPE,
  DOCUMENT_DIRECTION,
  MARITAL_STATUS,
  MASTER_DECISION,
  NATIONALITY,
  NATIONALITY_SECTION,
  POST_COUNTER,
  PRIVACY,
  REFER_TO_MASTER,
  URGENCY
} from "./wire.js";

/**
 * Ten seconds. Long enough for api to reach Postgres under load, short enough that a caseworker is not
 * left on a blank page: without an explicit signal `fetch` waits on the OS, which can be minutes.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** The multipart field name api reads the upload from. Matches `UploadPolicy.UPLOAD_FILE_FIELD`. */
const UPLOAD_FILE_FIELD = "file";

/** The case list, filtered by one of the saved-query keys. */
export async function listCases(filter: string | undefined, config: ApiConfig): Promise<ApiResult<CaseList>> {
  const query = filter === undefined ? "" : `?filter=${encodeURIComponent(filter)}`;

  return request(config, "GET", `/caseworker/cases${query}`, WIRE_SCHEMAS.CaseListResponse);
}

/** One case with its notes, witnesses and documents. One call, because the detail page needs all four. */
export function getCase(id: string, config: ApiConfig): Promise<ApiResult<WireCaseDetail>> {
  return request(config, "GET", `/caseworker/cases/${encodeURIComponent(id)}`, WIRE_SCHEMAS.CaseDetailResponse);
}

/**
 * Create a case. api allocates the reference number and returns it.
 *
 * A create with no `dateReceived` comes back as a `validation` failure attributed to that field, because
 * the reference's year is derived from it. That is api's rule, not a check repeated here — a second
 * opinion about a reference number is exactly what task 3 of the plan forbids.
 */
export function createCase(patch: WireCaseWrite, config: ApiConfig): Promise<ApiResult<SavedCase>> {
  return request(config, "POST", "/caseworker/cases", WIRE_SCHEMAS.SavedCaseResponse, patch);
}

/** Patch a case. Omitted fields are left alone; a field sent as null clears it. */
export function patchCase(id: string, patch: WireCaseWrite, config: ApiConfig): Promise<ApiResult<SavedCase>> {
  return request(config, "PATCH", `/caseworker/cases/${encodeURIComponent(id)}`, WIRE_SCHEMAS.SavedCaseResponse, patch);
}

/**
 * The show / hide / mandate rules for a case type.
 *
 * All three inputs are sent, because all three change the answer: `publishToGazette` is what decides
 * whether the Gazette notice date appears at all.
 */
export async function getFieldRules(query: FieldRulesQuery, config: ApiConfig): Promise<ApiResult<FieldRules>> {
  const parameters = new URLSearchParams();
  if (query.type != null) parameters.set("type", query.type);
  if (query.migrated !== undefined) parameters.set("migrated", String(query.migrated));
  if (query.publishToGazette !== undefined) parameters.set("publishToGazette", String(query.publishToGazette));

  const result = await request<typeof WIRE_SCHEMAS.FieldRulesResponse>(
    config,
    "GET",
    `/caseworker/cases/field-rules?${parameters.toString()}`,
    WIRE_SCHEMAS.FieldRulesResponse
  );

  // Unwrapped from api's envelope: the envelope exists so the response is an object rather than a bare
  // map, and every caller here wants the map.
  return mapResult(result, (wire: WireFieldRules) => wire.rules);
}

/** Notes for a case, as api orders them. */
export function listNotes(caseId: string, config: ApiConfig): Promise<ApiResult<Note[]>> {
  return request(config, "GET", `/caseworker/cases/${encodeURIComponent(caseId)}/notes`, WIRE_SCHEMAS.NoteResponse.array());
}

export function getNote(caseId: string, noteId: string, config: ApiConfig): Promise<ApiResult<Note>> {
  return request(config, "GET", notePath(caseId, noteId), WIRE_SCHEMAS.NoteResponse);
}

/** Create a note. The author comes from the caller's token, so it is not a parameter. */
export function createNote(caseId: string, note: string, config: ApiConfig): Promise<ApiResult<Note>> {
  return request(config, "POST", `/caseworker/cases/${encodeURIComponent(caseId)}/notes`, WIRE_SCHEMAS.NoteResponse, { note });
}

/**
 * Amend a note.
 *
 * `note` is optional because api's `UpdateNoteRequest` declares it so: an empty patch is legitimate
 * there and re-stamps `modifiedBy`. An omitted value is left out of the body rather than sent as null
 * — `JSON.stringify` drops an undefined property — so api applies its own rule instead of being told
 * to clear the text.
 */
export function patchNote(caseId: string, noteId: string, note: string | undefined, config: ApiConfig): Promise<ApiResult<Note>> {
  return request(config, "PATCH", notePath(caseId, noteId), WIRE_SCHEMAS.NoteResponse, { note });
}

/**
 * Delete a note. 204, so there is no body and nothing to parse.
 *
 * api's thirteenth caseworker operation, added for this app — its note form has always had a delete
 * button. See the prerequisite section of `docs/plans/02-dal-cutover-to-api.md`.
 */
export function deleteNote(caseId: string, noteId: string, config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "DELETE", notePath(caseId, noteId));
}

/**
 * Upload one supporting document.
 *
 * Multipart, because that is what api's endpoint consumes. The bytes are not stored here — this app has
 * no store, which is the whole point of deleting `file-storage.ts` in task 4.
 */
export function uploadDocument(caseId: string, upload: DocumentUpload, config: ApiConfig): Promise<ApiResult<Document>> {
  const form = new FormData();
  form.append(UPLOAD_FILE_FIELD, new Blob([upload.bytes as Uint8Array<ArrayBuffer>], { type: upload.mimeType }), upload.name);
  form.append("documentTypeId", upload.documentTypeId);
  // Both omitted unless asked for, so api applies its own defaults — the row's name falls back to the
  // file's and the direction to Incoming. Sending an empty string instead would name the row "".
  if (upload.documentName !== undefined) form.append("name", upload.documentName);
  if (upload.direction !== undefined) form.append("direction", upload.direction);

  return request(config, "POST", `/caseworker/cases/${encodeURIComponent(caseId)}/documents`, WIRE_SCHEMAS.DocumentResponse, form);
}

/**
 * Fetch a document's bytes.
 *
 * Returns the body as a stream plus the headers a download response needs, rather than buffering: a
 * scanned deed poll is megabytes, and the page's job is to forward them. api decides the filename and
 * the disposition, so neither is re-derived here.
 */
export async function downloadDocument(caseId: string, documentId: string, config: ApiConfig): Promise<ApiResult<DocumentDownload>> {
  const path = `/caseworker/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/file`;
  const sent = await send(config, "GET", path, undefined, "*/*");
  if (!sent.ok) return sent;

  const response = sent.response;
  if (!response.body) {
    return { ok: false, error: { kind: "invalid-response", status: response.status, message: `GET ${path} returned no body` } };
  }

  return {
    ok: true,
    data: {
      // Converted to a Node stream here rather than by each caller. `fetch` produces a web
      // `ReadableStream` and an Express response wants something with `.pipe`, so the two download
      // routes both had to bridge it — and TypeScript makes that bridge unpleasant, because
      // `lib.dom`'s `ReadableStream` and `node:stream/web`'s are structurally different types for the
      // same runtime object. Doing it at the only module that knows a response is HTTP keeps the cast
      // out of the pages entirely, which is what decision 1 of the plan asks for.
      body: Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      contentDisposition: response.headers.get("content-disposition")
    }
  };
}

/** Every supporting-document type, as api orders them. Read-only: api has no document-type writes. */
export function listDocumentTypes(config: ApiConfig): Promise<ApiResult<DocumentType[]>> {
  return request(config, "GET", "/caseworker/document-types", WIRE_SCHEMAS.DocumentTypeResponse.array());
}

/**
 * Whether api is answering.
 *
 * Its `/health` is unauthenticated, so this says nothing about whether this app's credentials work — but
 * a readiness probe that goes green while api is unreachable is the failure task 5 of the plan calls out,
 * and this is what stops it.
 */
export async function checkApiReachable(config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "GET", "/health");
}

function notePath(caseId: string, noteId: string): string {
  return `/caseworker/cases/${encodeURIComponent(caseId)}/notes/${encodeURIComponent(noteId)}`;
}

/**
 * One HTTP call: send, classify the outcome, parse the body.
 *
 * `schema` is what makes a malformed success distinguishable from a real one. Without it a response
 * missing `displayReference` would reach a case heading as the string "undefined", which is the sort of
 * defect that only shows up in production.
 */
async function request<S extends z.ZodType>(config: ApiConfig, method: string, path: string, schema: S, body?: unknown): Promise<ApiResult<z.infer<S>>> {
  const sent = await send(config, method, path, body, "application/json");
  if (!sent.ok) return sent;

  let payload: unknown;
  try {
    payload = await sent.response.json();
  } catch {
    return { ok: false, error: { kind: "invalid-response", status: sent.response.status, message: `${method} ${path} returned a body that is not JSON` } };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // The issue PATHS, never the values: a rejected body is the applicant's own data coming back.
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    return {
      ok: false,
      error: { kind: "invalid-response", status: sent.response.status, message: `${method} ${path} returned an unexpected shape (${fields})` }
    };
  }

  return { ok: true, data: parsed.data };
}

/** A call whose success carries nothing to parse — a 204, or a probe where only the status matters. */
async function requestNoContent(config: ApiConfig, method: string, path: string): Promise<ApiResult<void>> {
  const sent = await send(config, method, path, undefined, "application/json");

  return sent.ok ? { ok: true, data: undefined } : sent;
}

/**
 * The transport half: build the request, send it, and classify anything that is not a 2xx.
 *
 * Split from `request` so the streaming download shares the classification. Failures come back as the
 * same `ApiResult` shape, which is what lets every caller branch once.
 */
async function send(config: ApiConfig, method: string, path: string, body: unknown, accept: string): Promise<SendResult> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${path}`;
  const isForm = body instanceof FormData;
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      // Let fetch set the multipart content-type: it has to append the boundary it generated, and
      // setting the header by hand produces a body no server can parse.
      headers: {
        accept,
        ...(config.accessToken === undefined ? {} : { authorization: `Bearer ${config.accessToken}` }),
        ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {})
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });
  } catch (error) {
    return { ok: false, error: transportError(error) };
  }

  if (!response.ok) return { ok: false, error: await failureFromResponse(response) };

  return { ok: true, response };
}

/**
 * A call that never got an answer.
 *
 * A timeout is separated from a refused connection because they mean different things operationally —
 * one is a slow dependency, the other is a service that is down — even though both show a caseworker the
 * same page.
 */
function transportError(error: unknown): ApiError {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { kind: "timeout", message: "deed-poll-api did not respond in time" };
  }

  return { kind: "unavailable", message: "deed-poll-api could not be reached" };
}

/**
 * Classify a non-2xx by status, picking up api's field errors when the body carries them.
 *
 * The mapping is deliberately the inverse of what `apps/web/src/errors.ts` already does with thrown
 * domain errors: `not-found` becomes its 404 page and `forbidden` its 403, so a refusal that used to
 * originate from a Prisma-backed throw renders identically now that it originates from api.
 */
async function failureFromResponse(response: Response): Promise<ApiError> {
  const payload = await readJsonOrNull(response);
  const parsed = UNSPECIFIED_SCHEMAS.ApiError.safeParse(payload);
  const message = parsed.success ? parsed.data.error : `deed-poll-api answered ${response.status}`;
  const fieldErrors = parsed.success ? (parsed.data.errors ?? []) : [];

  if (response.status === 400 || response.status === 422) return { kind: "validation", status: response.status, message, fieldErrors };
  if (response.status === 401) return { kind: "unauthorized", status: response.status, message };
  if (response.status === 403) return { kind: "forbidden", status: response.status, message };
  if (response.status === 404) return { kind: "not-found", status: response.status, message };
  if (response.status === 409) return { kind: "conflict", status: response.status, message };

  // 408 and 429 sit with the 5xxs: all of them mean "come back shortly", not "your input is wrong".
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { kind: "unavailable", status: response.status, message };
  }

  return { kind: "unknown", status: response.status, message };
}

/** A failure body is best-effort — an unavailable api often answers with a proxy's HTML. */
async function readJsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Apply a mapping to a successful result, leaving failures untouched. */
function mapResult<W, T>(result: ApiResult<W>, map: (value: W) => T): ApiResult<T> {
  return result.ok ? { ok: true, data: map(result.data) } : result;
}

/** Where api is, how long to wait for it, and the token to present. Supplied by the app's config. */
export interface ApiConfig {
  baseUrl: string;
  timeoutMs?: number;
  /**
   * The caller's IDAM access token. api authenticates every caseworker route and derives the audit name
   * and admin status from the token, so a call without one is a 401 — which is why this is not optional
   * in practice even though `/health` needs none.
   */
  accessToken?: string;
}

/** Success or a classified failure. Never a thrown error — see the note at the head of the file. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * What went wrong, in terms a caller can branch on.
 *
 * - `validation` — api rejected the content; `fieldErrors` map onto an error summary
 * - `not-found` — no such case, note or document
 * - `forbidden` / `unauthorized` — the caller's token is missing, expired, or lacks a role
 * - `conflict` — the record's state does not allow this
 * - `unavailable` / `timeout` — nobody's fault; try again shortly
 * - `invalid-response` — a 2xx whose body does not match the contract. A bug at one end or the other,
 *   and worth distinguishing from `unavailable` so it is not dismissed as a blip
 * - `unknown` — a status the contract does not describe
 */
export interface ApiError {
  kind: ApiErrorKind;
  status?: number;
  /** For developers and logs. Never rendered as-is: pages carry their own copy. */
  message: string;
  fieldErrors?: readonly ApiFieldError[];
}

export type ApiErrorKind = "validation" | "not-found" | "forbidden" | "unauthorized" | "conflict" | "unavailable" | "timeout" | "invalid-response" | "unknown";

export interface ApiFieldError {
  /** api's field name, so an error summary can link to the input that caused it. */
  field: string;
  message: string;
}

/**
 * The domain types, which are api's response shapes with the wire conversions already applied.
 *
 * Aliases rather than restatements: the properties are identical — api's JSON is camelCase and this
 * repo's naming rules want camelCase — so a second declaration would be a list to keep in step for no
 * benefit. The wire module stays unexported all the same, because what must not leak is the SCHEMAS and
 * the freedom to parse a response somewhere other than here.
 */
export type SavedCase = WireSavedCase;
export type CaseDetail = WireCaseDetail;
export type CaseSummary = WireCaseList["cases"][number];
export type CaseList = WireCaseList;
export type Note = WireNote;
export type Witness = WireCaseDetail["witnesses"][number];
export type Document = WireDocument;
export type DocumentType = WireDocumentType;
export type FieldRules = WireFieldRules["rules"];
export type FieldRule = FieldRules[string];
export type CaseWrite = WireCaseWrite;

/**
 * The option sets, as the member unions a caller annotates with.
 *
 * Derived from the response shape rather than restated, so a member added to api's enum reaches
 * these without a second edit. `NonNullable` because every one of these columns is nullable on a
 * case — an option set's members are not the same question as whether one has been chosen.
 */
export type CaseType = NonNullable<SavedCase["type"]>;
export type CaseState = NonNullable<SavedCase["state"]>;
export type Privacy = NonNullable<SavedCase["privacy"]>;
export type Urgency = NonNullable<SavedCase["urgency"]>;
export type PostCounter = NonNullable<SavedCase["postCounter"]>;
export type MaritalStatus = NonNullable<SavedCase["maritalStatus"]>;
export type Nationality = NonNullable<SavedCase["nationality"]>;
export type NationalitySection = NonNullable<SavedCase["nationalitySection"]>;
export type MasterDecision = NonNullable<SavedCase["masterDecision"]>;
export type ReferToMaster = NonNullable<SavedCase["referToMasterChoice"]>;
export type DocumentDirection = NonNullable<Document["direction"]>;

export interface FieldRulesQuery {
  type?: CaseType | null;
  migrated?: boolean;
  publishToGazette?: boolean;
}

/** One file on its way to api. `documentName` overrides the row's display name, which defaults to the file's. */
export interface DocumentUpload {
  documentTypeId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  documentName?: string;
  direction?: DocumentDirection;
}

/**
 * A document's bytes, still streaming, plus what api said they are.
 *
 * A Node `Readable` rather than the web stream `fetch` produced, so a route can pipe it straight at an
 * Express response. Nothing is buffered on the way through: a scanned deed poll is megabytes.
 */
export interface DocumentDownload {
  body: Readable;
  contentType: string;
  contentDisposition: string | null;
}

type SendResult = { ok: true; response: Response } | { ok: false; error: ApiError };
