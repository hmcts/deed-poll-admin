/**
 * The only module in this repo that knows `deed-poll-api` exists.
 *
 * Plain functions over `fetch`, per decision 1 of `docs/plans/completed/02-dal-cutover-to-api.md`. Everything
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
  type WireSavedCase,
  type WireWitnessCreate,
  type WireWitnessUpdate
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

/**
 * Sixty seconds, for the one call that sends a body instead of receiving one.
 *
 * `DEFAULT_TIMEOUT_MS` is sized for a request whose body is a few hundred bytes, so the clock is really
 * measuring api's thinking time. A multipart upload is up to `MAX_UPLOAD_BYTES` — 25 MB — and the same
 * clock covers pushing all of it across the wire *and* api storing it, which ten seconds does not
 * reliably allow: 25 MB in ten seconds needs a sustained 2.5 MB/s with nothing left over for the write.
 *
 * It is the download's problem in the other direction, and it does not have the download's answer. There
 * a per-read bound replaces the whole-exchange one, because a body this app is READING can be measured
 * chunk by chunk. A body it is SENDING cannot: `fetch` gives no hook on upload progress, so the only
 * available lever is more patience. And the failure being avoided is worse than a slow page — an abort
 * lands after api may already have committed the document row, leaving a document the caseworker was
 * told failed and no endpoint to delete it with (see `documents/service.ts`, four writes api does not
 * have).
 *
 * Still bounded, and still overridable: `DEED_POLL_API_TIMEOUT_MS` wins over this the same way it wins
 * over the default, so an environment that needs a different figure sets one number rather than two.
 */
const UPLOAD_TIMEOUT_MS = 60_000;

/** The multipart field name api reads the upload from. Matches `UploadPolicy.UPLOAD_FILE_FIELD`. */
const UPLOAD_FILE_FIELD = "file";

/**
 * One page of the case list: a saved-query filter, field-level conditions, an order and a page.
 *
 * `where` is REPEATED rather than joined, because that is api's format — one parameter per condition,
 * ANDed. `URLSearchParams` is what builds the string, so a value carrying a colon, a comma, an ampersand
 * or a space is encoded rather than re-splitting the URL at api's end.
 *
 * Every part is optional and an omitted one is not sent at all, so api applies its own default: no
 * filter is "all", no sort is newest first, and no page is the first 25. Sending this app's idea of those
 * defaults would be a second opinion about them, and the one that shows up in a bookmarked URL.
 */
export async function listCases(query: CaseListQuery, config: ApiConfig): Promise<ApiResult<CaseList>> {
  const parameters = new URLSearchParams();
  if (query.filter !== undefined) parameters.set("filter", query.filter);
  for (const condition of query.where ?? []) parameters.append("where", condition);
  if (query.sort !== undefined) parameters.set("sort", query.sort);
  if (query.page !== undefined) parameters.set("page", String(query.page));
  if (query.size !== undefined) parameters.set("size", String(query.size));

  const search = parameters.toString();

  return request(config, "GET", `/caseworker/cases${search === "" ? "" : `?${search}`}`, WIRE_SCHEMAS.CaseListResponse);
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
 * button. See the prerequisite section of `docs/plans/completed/02-dal-cutover-to-api.md`.
 */
export function deleteNote(caseId: string, noteId: string, config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "DELETE", notePath(caseId, noteId));
}

/**
 * A case's witnesses, oldest first — the order the detail page's subgrid renders them in.
 *
 * A witness list is also carried inside `GET /caseworker/cases/{id}`, so a page that already holds the
 * case has no reason to call this. It exists because api serves it and the contract test is exhaustive
 * over api's surface: an operation api publishes with no function here is drift, not economy.
 */
export function listWitnesses(caseId: string, config: ApiConfig): Promise<ApiResult<Witness[]>> {
  return request(config, "GET", `/caseworker/cases/${encodeURIComponent(caseId)}/witnesses`, WIRE_SCHEMAS.WitnessResponse.array());
}

/** One witness of one case. A witness id under the wrong case is api's 404, not a check made here. */
export function getWitness(caseId: string, witnessId: string, config: ApiConfig): Promise<ApiResult<Witness>> {
  return request(config, "GET", witnessPath(caseId, witnessId), WIRE_SCHEMAS.WitnessResponse);
}

/**
 * Add a witness. All four fields are required, and neither write is role-gated at api's end.
 *
 * No author parameter, and not for the reason a note has none: `deedpoll_witness` has no author columns at
 * all, only the two timestamps api stamps itself.
 */
export function createWitness(caseId: string, witness: WitnessCreate, config: ApiConfig): Promise<ApiResult<Witness>> {
  return request(config, "POST", `/caseworker/cases/${encodeURIComponent(caseId)}/witnesses`, WIRE_SCHEMAS.WitnessResponse, witness);
}

/**
 * Amend a witness.
 *
 * Only the fields the patch names are written; an omitted one is left as stored, and an empty patch is
 * accepted — it re-stamps `modifiedOn`. A field sent as null is api's 400 rather than a clear, because
 * none of the four columns is nullable, which is why the patch type has no null in it to send.
 */
export function updateWitness(caseId: string, witnessId: string, patch: WitnessPatch, config: ApiConfig): Promise<ApiResult<Witness>> {
  return request(config, "PATCH", witnessPath(caseId, witnessId), WIRE_SCHEMAS.WitnessResponse, patch);
}

/**
 * Delete a witness. 204, so there is no body — the deleted witness is not one.
 *
 * **The only witness operation api gates on a role.** `WitnessService.removeWitness` requires
 * `caseworker-deedpoll-admin` before it resolves the witness, so a caller without it gets `forbidden`
 * whether or not the witness exists — and gets it here too, since the gate is api's and no copy of it is
 * made in this adapter. Both ids go on the wire for the reason the note delete's do: a witness addressed
 * through the wrong case is api's 404 rather than a row deleted through the wrong parent.
 */
export function deleteWitness(caseId: string, witnessId: string, config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "DELETE", witnessPath(caseId, witnessId));
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

  // The only call given a timeout of its own — see `UPLOAD_TIMEOUT_MS` for why the JSON default is the
  // wrong bound for a request that sends 25 MB.
  const timeoutMs = config.timeoutMs ?? UPLOAD_TIMEOUT_MS;

  return request({ ...config, timeoutMs }, "POST", `/caseworker/cases/${encodeURIComponent(caseId)}/documents`, WIRE_SCHEMAS.DocumentResponse, form);
}

/**
 * Fetch a document's bytes.
 *
 * Returns the body as a stream plus the headers a download response needs, rather than buffering: a
 * scanned deed poll is megabytes, and the page's job is to forward them. api decides the filename and
 * the disposition, so neither is re-derived here.
 *
 * `streaming`, so the timeout bounds how long api takes to ANSWER rather than how long the whole body
 * takes to arrive. A 25 MB scan on a slow link legitimately outlives `DEFAULT_TIMEOUT_MS`, and an abort
 * after the headers are sent does not fail the download — it truncates it, which no error page can undo.
 * What replaces the whole-exchange bound is a per-read one: see `bounded`.
 */
export async function downloadDocument(caseId: string, documentId: string, config: ApiConfig): Promise<ApiResult<DocumentDownload>> {
  const path = `/caseworker/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/file`;
  const sent = await send(config, "GET", path, undefined, "*/*", true);
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
      body: Readable.fromWeb(bounded(response.body, config.timeoutMs ?? DEFAULT_TIMEOUT_MS) as NodeReadableStream<Uint8Array>),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      contentDisposition: response.headers.get("content-disposition"),
      contentSecurityPolicy: response.headers.get("content-security-policy"),
      contentTypeOptions: response.headers.get("x-content-type-options")
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
 * `/health/liveness` and not the ungrouped `/health`, deliberately. api's `application.yaml` restricts
 * that group to `livenessState` — "should this process be killed", nothing but the process itself —
 * whereas `/health` aggregates *every* registered contributor, including api's own `db` and
 * `deedPollSchema` checks and Boot's auto-configured `diskSpace`. A DOWN contributor answers 503, which
 * classifies as `unavailable`, which would take this app's readiness down with it: a blip in api's
 * database would drop every web pod out of its Service at once and return 503 for `/login`, `/cookies`
 * and the accessibility statement, none of which touch api. Cascading a dependency's data-plane verdict
 * into our own readiness turns a degraded service into an unreachable one.
 *
 * Both paths are on api's `SecurityConfiguration.PUBLIC_PATHS` allowlist, so this presents no token and
 * says nothing about whether this app's credentials work — but a readiness probe that goes green while
 * api is unreachable is the failure task 5 of the plan calls out, and this is what stops it.
 */
export async function checkApiReachable(config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "GET", "/health/liveness");
}

function notePath(caseId: string, noteId: string): string {
  return `/caseworker/cases/${encodeURIComponent(caseId)}/notes/${encodeURIComponent(noteId)}`;
}

function witnessPath(caseId: string, witnessId: string): string {
  return `/caseworker/cases/${encodeURIComponent(caseId)}/witnesses/${encodeURIComponent(witnessId)}`;
}

/**
 * A download body that fails if api stops sending it, without failing one that is merely slow.
 *
 * The whole-exchange timeout is cleared once the headers are in hand — see `send` — so this is what
 * bounds the transfer itself: every read of api's stream gets the same patience, so bytes that keep
 * arriving keep a 25 MB scan alive while a silence longer than the timeout ends it. Left unbounded, a
 * body api never finishes holds an `undici` socket and the caseworker's own response open for as long as
 * api chooses to say nothing, and Node's default is five minutes of that per stalled download.
 *
 * The timer covers only an OUTSTANDING read, which is why this wraps the reader instead of watching
 * chunks go past: `pull` runs when the consumer asks for more, so a caseworker on a slow connection
 * back-pressuring the stream is not mistaken for api going quiet.
 *
 * **A stall is an error and not an end-of-stream**, deliberately. Cancelling resolves the pending read as
 * `done`, and a body that merely ends leaves the route sending a short file under a 200 it has already
 * committed to — the silent truncation this whole arrangement exists to avoid. Erroring destroys the
 * response instead, so the browser sees an aborted transfer rather than a corrupt document.
 */
function bounded(body: ReadableStream<Uint8Array>, timeoutMs: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let stalled = false;
      const timer = setTimeout(() => {
        stalled = true;
        // Releases the socket rather than leaving it waiting on bytes nobody is going to read. The
        // rejection is swallowed rather than left floating: `cancel` rejects when the stream is already
        // errored — api's connection dropping in the same tick as this timer — and an unhandled rejection
        // is a fatal uncaught exception in Node, so the pod would exit over one failed download. The
        // reason for cancelling is recorded in `stalled`, so a failed cancel needs nothing beyond this.
        reader.cancel(new DOMException("timeout", "TimeoutError")).catch(() => {});
      }, timeoutMs);

      try {
        const { done, value } = await reader.read();
        if (stalled) throw new DOMException("deed-poll-api stopped sending the document", "TimeoutError");
        if (done) controller.close();
        else controller.enqueue(value);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel: (reason) => reader.cancel(reason)
  });
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
  } catch (error) {
    // A read the timeout cut short is a slow api, not a contract breach. `invalid-response` means "a bug at
    // one end or the other" and is the thing an operator is meant to investigate rather than dismiss, so
    // reporting a stall as one sends them hunting a defect when the answer is that api stopped talking.
    if (isAborted(error)) return { ok: false, error: transportError(error) };

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
  if (!sent.ok) return sent;

  // Discarded rather than ignored: `/health/liveness` answers 200 with a body, and `undici` holds the connection
  // out of its pool until an unread body is garbage-collected. The readiness probe runs for the life of
  // the pod, so that is socket churn on a timer.
  await sent.response.body?.cancel();

  return { ok: true, data: undefined };
}

/**
 * The transport half: build the request, send it, and classify anything that is not a 2xx.
 *
 * Split from `request` so the streaming download shares the classification. Failures come back as the
 * same `ApiResult` shape, which is what lets every caller branch once.
 *
 * `streaming` chooses what the timeout covers, and the two answers are genuinely different rules rather
 * than a knob. A JSON call is bounded end to end, because its body is small and read here: an api that
 * sends headers and then stalls must still fail. A download's body is the CALLER's to read and is
 * megabytes, so this clock stops once the response is in hand — an `AbortSignal` is not scoped to the
 * headers, and firing it mid-body truncates the file the caseworker is saving while the response has
 * already gone out as a 200. That does not leave the transfer unbounded: `bounded` re-applies the same
 * patience to each read of the body, which fails a stalled download without failing a slow one.
 */
async function send(config: ApiConfig, method: string, path: string, body: unknown, accept: string, streaming = false): Promise<SendResult> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${path}`;
  const isForm = body instanceof FormData;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // A cancellable timer for the streaming case; `AbortSignal.timeout` cannot be called off once armed.
  const controller = streaming ? new AbortController() : undefined;
  const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);

  try {
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
        signal: controller?.signal ?? AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return { ok: false, error: transportError(error) };
    }

    if (!response.ok) return { ok: false, error: await failureFromResponse(response) };

    return { ok: true, response };
  } finally {
    // Inside the `finally` so the failure body above is still read under the timeout: an unavailable api
    // often answers with a proxy's HTML, and reading that must not be the unbounded wait.
    clearTimeout(timer);
  }
}

/**
 * A call that never got an answer.
 *
 * A timeout is separated from a refused connection because they mean different things operationally —
 * one is a slow dependency, the other is a service that is down — even though both show a caseworker the
 * same page.
 */
function transportError(error: unknown): ApiError {
  if (isAborted(error)) return { kind: "timeout", message: "deed-poll-api did not respond in time" };

  return { kind: "unavailable", message: "deed-poll-api could not be reached" };
}

/**
 * Whether the abort signal cut this short, rather than the connection failing.
 *
 * By name, because Node reports it as a `DOMException` and not as a distinguishable type — and the same
 * check has to serve both the `fetch` and the body read, which fail at different points for one cause.
 */
function isAborted(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";

  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Classify a non-2xx by status, picking up api's field errors when the body carries them.
 *
 * The mapping is deliberately the inverse of what `src/errors.ts` already does with thrown
 * domain errors: `not-found` becomes its 404 page and `forbidden` its 403, so a refusal that used to
 * originate from a Prisma-backed throw renders identically now that it originates from api.
 */
async function failureFromResponse(response: Response): Promise<ApiError> {
  const payload = await readJsonOrNull(response);
  const parsed = UNSPECIFIED_SCHEMAS.ApiError.safeParse(payload);
  const message = parsed.success ? parsed.data.error : `deed-poll-api answered ${response.status}`;
  const fieldErrors = parsed.success ? (parsed.data.errors ?? []) : [];

  // 413 and 415 sit with 400: a file api judges too large or of a type it will not take is the
  // caseworker's input, not a fault. Left as `unknown` they became a plain `Error` and the 500 page,
  // which is the trap `upload-policy.ts` documents — telling someone the service has broken when in
  // fact their file was refused. `upload-policy.ts` rejects both locally first, but its size limit is
  // this repo's guess and api's is api's, so the window between the two is reachable.
  if (response.status === 400 || response.status === 413 || response.status === 415 || response.status === 422) {
    return { kind: "validation", status: response.status, message, fieldErrors };
  }
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
   * in practice even though `/health/liveness` needs none.
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
export type WitnessCreate = WireWitnessCreate;
export type WitnessPatch = WireWitnessUpdate;
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

/**
 * What to ask the case list for, in api's own vocabulary.
 *
 * Strings rather than a modelled query, deliberately: composing a condition is the domain's job — this is
 * the layer that puts one on the wire, and `field:operator:value` is api's format for it, published in
 * `openapi.json`. `libs/deed-poll`'s `caseQueryWhere` is what produces the entries, and it is the only
 * thing that should.
 */
export interface CaseListQuery {
  /** One of api's saved-query keys. It composes with `where` rather than being replaced by it. */
  filter?: string;
  /** Conditions as `field:operator:value`, ANDed. api caps them at 20 and refuses the request beyond that. */
  where?: readonly string[];
  /** `field` or `field:asc` or `field:desc`. Omitted is newest first. */
  sort?: string;
  /** 1-based. */
  page?: number;
  /** Rows per page. api defaults to 25 and clamps anything above 100 to 100. */
  size?: number;
}

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
 *
 * **All four headers, not just the two a download needs to be readable.** api serves PDFs, JPEGs and
 * PNGs `inline`, and the policy that makes that safe travels with the disposition: a PDF is an
 * active-content format whose viewer runs embedded script, so api pairs `inline` with
 * `Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options: nosniff`. Carrying
 * the disposition without the policy honours api's decision to render in place while dropping its
 * argument for why that is allowed.
 */
export interface DocumentDownload {
  body: Readable;
  contentType: string;
  contentDisposition: string | null;
  contentSecurityPolicy: string | null;
  contentTypeOptions: string | null;
}

type SendResult = { ok: true; response: Response } | { ok: false; error: ApiError };
