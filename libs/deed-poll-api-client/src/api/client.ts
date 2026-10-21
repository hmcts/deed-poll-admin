/**
 * The only module in this repo that knows `deed-poll-api` exists.
 *
 * Plain functions over `fetch`, per decision 1 of `docs/plans/completed/02-dal-cutover-to-api.md`. Everything
 * above this line deals in cases, notes, witnesses and documents; nothing above it sees a URL, an HTTP
 * status or a multipart boundary. When api's shape changes, this file changes.
 *
 * NOTHING HERE THROWS ON A FAILED CALL. Every function returns `ApiResult`, a discriminated union the
 * caller branches on, because this app is a caseworker's whole working day: an unreachable api has to be
 * a page that keeps their form, not a 500 that loses it. Invalid base URL configuration is a
 * programming error: it throws before a request can send the caller's token or case data.
 *
 * No request or response logging, deliberately: a case body is an applicant's name, address, date of
 * birth and the reason they are changing their name. The no-PII-in-logs rule has no debugging exception.
 */
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { z } from "zod";
import { assertApiBaseUrl } from "./transport.js";
import type {
  WireGazetteError,
  WireGazetteMembers,
  WireGazettePreview,
  WireGazetteRequests,
  WireGazetteStatus,
  WirePreviewGazette,
  WireSubmitGazette
} from "./wire.js";
import {
  WIRE_SCHEMAS,
  type WireCallerAccess,
  type WireCaseDetail,
  type WireCaseEmails,
  type WireCaseList,
  type WireCaseWrite,
  type WireCorrespondenceDocument,
  type WireDocument,
  type WireDocumentType,
  type WireEmailHistory,
  type WireEmailPreview,
  type WireEmailSlot,
  type WireEmailSlotDefaults,
  type WireEmailSlotsWrite,
  type WireEmailType,
  type WireFieldRules,
  type WireGazetteNoticeBatch,
  type WireGazetteNoticeHistory,
  type WireGazetteSettings,
  type WireJudicialApplicationView,
  type WireJudicialCaseNote,
  type WireJudicialDirection,
  type WireJudicialDocument,
  type WireJudicialMyReferrals,
  type WireJudicialPool,
  type WireJudicialReferralDetail,
  type WireJudicialReferralSummary,
  type WireJudicialWitness,
  type WireNote,
  type WireRecordConfirmation,
  type WireReferral,
  type WireReferralCreate,
  type WireSavedCase,
  type WireSavedQuery,
  type WireSavedQueryCreate,
  type WireSavedQueryUpdate,
  type WireSentEmail,
  type WireUpdateGazetteSettings,
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
  // The caller's capabilities, for the same reason: admin renders every privileged control from `GET /me`'s
  // answer, and narrowing a stored answer against the published members is what drops one api has retired.
  CAPABILITY,
  // The applicant's two possible answers to *Request confirmation to proceed*. Re-exported for the same reason
  // as the option sets: the confirmation form renders a radio per member, and the members are api's. It is the
  // one vocabulary here that is NOT a named schema in the document — api publishes both member lists inline —
  // so `contract.test.ts` pins it against the two properties that carry it.
  CONFIRMATION_OUTCOME,
  DEED_POLL_STATE,
  DEED_POLL_TYPE,
  DOCUMENT_DIRECTION,
  // The two saved-query vocabularies, for the same reason as the option sets above: the domain turns a
  // caseworker's chosen tab and sort order into a create body, and narrowing against the published array
  // is what fails to compile on the day api's filters are not this app's tabs. Casting instead would
  // let a divergence reach the wire as a 400.
  LIST_FILTER,
  MARITAL_STATUS,
  MASTER_DECISION,
  NATIONALITY,
  NATIONALITY_SECTION,
  // The outbox states, for the same reason: the Email tab renders a label per member, and the members are
  // api's. Its `NOTIFY_STATE` docblock carries the constraint on what those labels may say — `Sent` means
  // Notify accepted the email and nothing more, so no label built from these may read as proof of receipt.
  NOTIFY_STATE,
  POST_COUNTER,
  PRIVACY,
  REFER_TO_MASTER,
  // The two referral vocabularies, for the same reason as the option sets above: the referral form renders a
  // checkbox per reason and a page reads a referral's state, and both come from api's published members rather
  // than from a list typed out again here.
  REFERRAL_REASON,
  REFERRAL_STATE,
  SORT_DIRECTION,
  URGENCY
} from "./wire.js";

/**
 * Ten seconds. Long enough for api to reach Postgres under load, short enough that a caseworker is not
 * left on a blank page: without an explicit signal `fetch` waits on the OS, which can be minutes.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Sixty seconds, for the upload, which sends a large body instead of receiving one.
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
 * over the default, so an environment that needs a different figure sets one number rather than two. (The
 * Gazette submit is the exception: there it can only shorten `GAZETTE_SUBMIT_TIMEOUT_MS`.)
 */
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Twenty seconds, for the Gazette submit, because api sends the batch inside the request (finding R03,
 * `docs/plans/completed/20261021-r03-gazette-submit-timeout.md`).
 *
 * Four numbers bound that send, and this is the one this app controls:
 * - api waits up to 60 s on GOV.UK Notify (`GazetteNotify`'s call deadline, 30 s per read).
 * - The backend Application Gateway in front of api's `.internal` address cuts this app's call off at 30 s:
 *   deed-poll-api's entry in `azure-platform-terraform`'s `backend_lb_config.yaml` sets no `request_timeout`, so
 *   `terraform-module-application-backend` defaults it to 30, and answers 504.
 * - The frontend Application Gateway in front of this app cuts the **browser's** request off at 30 s too
 *   (`terraform-module-applicationgateway`'s `request_timeout` default). If this app is still waiting then, the
 *   caseworker gets the gateway's error page instead of the recovery page that carries the request's key.
 * - So this app must answer the browser inside 30 s in total, and the send request first re-checks every selected
 *   review (`gazetteReviewsCurrent`, up to 100 case reads, ten at a time). Twenty seconds leaves that, and the
 *   render, about ten. Because that re-check (and a token refresh) can take longer, the page also counts a 25 s
 *   budget from the request's arrival and passes what is left as the timeout, and under 5 s sends nothing
 *   (`src/gazette/send-deadline.ts`).
 *
 * A send over 20 s is still an unknown outcome — recoverable, because "Check request status" replays the same key —
 * until both gateways' `request_timeout` is raised or api answers 202 and sends in the background. Only the submit
 * gets this: the preview and the status read send nothing. It is a ceiling, not a default: a configured timeout
 * (`DEED_POLL_API_TIMEOUT_MS`, or what is left of the page's deadline) can only shorten the wait, never extend it
 * past the gateways (plan `docs/plans/completed/20261021-r03b-gazette-send-deadline.md`).
 */
const GAZETTE_SUBMIT_TIMEOUT_MS = 20_000;

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
  if (query.q !== undefined) parameters.set("q", query.q);
  for (const condition of query.where ?? []) parameters.append("where", condition);
  if (query.sort !== undefined) parameters.set("sort", query.sort);
  if (query.page !== undefined) parameters.set("page", String(query.page));
  if (query.size !== undefined) parameters.set("size", String(query.size));

  const search = parameters.toString();

  return request(config, "GET", `/caseworker/cases${search === "" ? "" : `?${search}`}`, WIRE_SCHEMAS.CaseListResponse);
}

/** Gazette writes classify only the published structured refusal as proof of no admission. */
export function previewGazetteNotice(input: PreviewGazette, config: ApiConfig): Promise<GazetteApiResult<GazettePreview>> {
  return gazetteRequest(config, "/caseworker/gazette-notice-previews", WIRE_SCHEMAS.GazettePreviewResponse, input);
}

export function submitGazetteNotice(input: SubmitGazette, key: string, config: ApiConfig): Promise<GazetteApiResult<GazetteStatus>> {
  const timeoutMs = Math.min(config.timeoutMs ?? GAZETTE_SUBMIT_TIMEOUT_MS, GAZETTE_SUBMIT_TIMEOUT_MS);
  return gazetteRequest({ ...config, timeoutMs }, "/caseworker/gazette-notices", WIRE_SCHEMAS.GazetteStatusResponse, input, key);
}

export function getGazetteRequests(query: GazetteRequestsQuery, config: ApiConfig): Promise<ApiResult<GazetteRequests>> {
  const parameters = new URLSearchParams();
  if (query.page !== undefined) parameters.set("page", String(query.page));
  if (query.size !== undefined) parameters.set("size", String(query.size));
  if (query.state !== undefined) parameters.set("state", query.state);
  return request(config, "GET", `/caseworker/gazette-notice-requests?${parameters}`, WIRE_SCHEMAS.GazetteRequestsResponse);
}

export function getGazetteStatus(batchId: string, config: ApiConfig): Promise<ApiResult<GazetteStatus>> {
  return request(config, "GET", `/caseworker/gazette-notices/${encodeURIComponent(batchId)}`, WIRE_SCHEMAS.GazetteStatusResponse);
}

export function getGazetteMembers(batchId: string, query: GazetteNoticeHistoryQuery, config: ApiConfig): Promise<ApiResult<GazetteMembers>> {
  const parameters = new URLSearchParams();
  if (query.page !== undefined) parameters.set("page", String(query.page));
  if (query.size !== undefined) parameters.set("size", String(query.size));
  return request(config, "GET", `/caseworker/gazette-notices/${encodeURIComponent(batchId)}/cases?${parameters}`, WIRE_SCHEMAS.GazetteMembersResponse);
}

/**
 * What api will let the caller do. Any authenticated token gets 200; a caller with no deed-poll role gets
 * `staff: false, judicial: false` and no capabilities rather than a 403.
 */
export function getCallerAccess(config: ApiConfig): Promise<ApiResult<CallerAccess>> {
  return request(config, "GET", "/me", WIRE_SCHEMAS.CallerAccessResponse);
}

export function getGazetteSettings(config: ApiConfig): Promise<ApiResult<GazetteSettings>> {
  return request(config, "GET", "/caseworker/gazette-settings", WIRE_SCHEMAS.GazetteSettingsResponse);
}

export function updateGazetteSettings(input: UpdateGazetteSettings, config: ApiConfig): Promise<ApiResult<GazetteSettings>> {
  return request(config, "PUT", "/caseworker/gazette-settings", WIRE_SCHEMAS.GazetteSettingsResponse, {
    recipientEmail: input.recipientEmail,
    revision: input.revision
  });
}

/** Admin-only audit history. Omitted paging stays omitted so api applies its own defaults. */
export function getGazetteNoticeHistory(query: GazetteNoticeHistoryQuery, config: ApiConfig): Promise<ApiResult<GazetteNoticeHistory>> {
  const parameters = new URLSearchParams();
  if (query.page !== undefined) parameters.set("page", String(query.page));
  if (query.size !== undefined) parameters.set("size", String(query.size));
  const search = parameters.toString();

  const querySuffix = search === "" ? "" : `?${search}`;

  return request(config, "GET", `/caseworker/gazette-notices${querySuffix}`, WIRE_SCHEMAS.GazetteNoticeHistoryResponse);
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
 * **The only witness operation api gates on a staff capability.** `WitnessService.removeWitness` requires
 * `DELETE_WITNESS` before it resolves the witness, so a caller without it gets `forbidden`
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

  // One of two calls given a timeout of its own — see `UPLOAD_TIMEOUT_MS` for why the JSON default is the
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
export function downloadDocument(caseId: string, documentId: string, config: ApiConfig): Promise<ApiResult<DocumentDownload>> {
  return download(config, `/caseworker/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/file`);
}

/**
 * Fetch one of a referral's supporting documents for the judge who may see it, streamed exactly as
 * {@link downloadDocument} is and with the same four headers, because api serves both with the same policy.
 *
 * `not-found` for a referral this judge may not see and for a document that is not on its application, and the
 * two are indistinguishable on purpose: see {@link getJudicialReferral}.
 */
export function downloadJudicialDocument(referralId: string, documentId: string, config: ApiConfig): Promise<ApiResult<DocumentDownload>> {
  return download(config, `${judicialReferralPath(referralId)}/documents/${encodeURIComponent(documentId)}/file`);
}

async function download(config: ApiConfig, path: string): Promise<ApiResult<DocumentDownload>> {
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
      // Retained as upstream metadata; the download route enforces nosniff rather than trusting it.
      contentTypeOptions: response.headers.get("x-content-type-options")
    }
  };
}

/** Every supporting-document type, as api orders them. Read-only: api has no document-type writes. */
export function listDocumentTypes(config: ApiConfig): Promise<ApiResult<DocumentType[]>> {
  return request(config, "GET", "/caseworker/document-types", WIRE_SCHEMAS.DocumentTypeResponse.array());
}

/**
 * A case's referrals to the judiciary, newest first — the order api's domain fetched them in.
 *
 * Every referral the case has ever had, not only the live one: a case may be referred many times over its
 * life, and the tab renders the history. Which of them is live is `state`, and api publishes the same answer
 * on the case itself as `currentReferralState`, so a page holding the case does not compute it.
 */
export function listReferrals(caseId: string, config: ApiConfig): Promise<ApiResult<Referral[]>> {
  return request(config, "GET", `/caseworker/cases/${encodeURIComponent(caseId)}/referrals`, WIRE_SCHEMAS.ReferralResponse.array());
}

/** One referral of one case. A referral id under the wrong case is api's 404, not a check made here. */
export function getReferral(caseId: string, referralId: string, config: ApiConfig): Promise<ApiResult<Referral>> {
  return request(config, "GET", referralPath(caseId, referralId), WIRE_SCHEMAS.ReferralResponse);
}

/**
 * Raise a referral, unclaimed into the shared pool. 201.
 *
 * `conflict` when the case already has a referral that is neither closed nor withdrawn — api allows many
 * referrals over a case's life but only one live at a time, and it answers 409 rather than 400 because a
 * second live referral is a state, not a malformed body. The author comes from the caller's token.
 */
export function createReferral(caseId: string, referral: ReferralCreate, config: ApiConfig): Promise<ApiResult<Referral>> {
  return request(config, "POST", `/caseworker/cases/${encodeURIComponent(caseId)}/referrals`, WIRE_SCHEMAS.ReferralResponse, referral);
}

/**
 * Withdraw a referral — the caseworker's way of taking one back before the judiciary has finished with it.
 *
 * **No body**, which is api's shape and not an omission: the sub-resource names the transition, so there is
 * nothing left to state. `conflict` unless the referral is `Open` or `Claimed` — api's
 * `ReferralState.canBeWithdrawn()`, which is **not** the negation of `isTerminal()`: a `Decided` referral is
 * non-terminal and still refused, because the direction on it has to be actioned and the referral closed
 * rather than taken back.
 */
export function withdrawReferral(caseId: string, referralId: string, config: ApiConfig): Promise<ApiResult<Referral>> {
  return request(config, "POST", `${referralPath(caseId, referralId)}/withdrawal`, WIRE_SCHEMAS.ReferralResponse);
}

/**
 * Close a referral once its direction has been actioned. No body, as the withdrawal has none.
 *
 * `conflict` unless the referral is `Decided`: closing is what records that the office has carried out the
 * judge's direction, so there has to be one to carry out.
 */
export function closeReferral(caseId: string, referralId: string, config: ApiConfig): Promise<ApiResult<Referral>> {
  return request(config, "POST", `${referralPath(caseId, referralId)}/closure`, WIRE_SCHEMAS.ReferralResponse);
}

/**
 * Record the applicant's answer to *Request confirmation to proceed* — `Confirmed` or `Withdrawn`, with the
 * caseworker's note as its evidence.
 *
 * **A body, unlike the two transitions above**, because the outcome is a fact a person read out of a mailbox
 * rather than a transition the sub-resource can name. What it may carry is `outcome` and `note` and nothing
 * else: `confirmationRecordedBy` comes from the token and `confirmationReceivedAt` from api's clock, and — like
 * every write body but the two email ones — it is published `additionalProperties: true`, so either one sent
 * from here would be **ignored rather than refused**, which is why `contract.test.ts` pins their absence from
 * the schema.
 *
 * The **saved referral** comes back, so a caller holds the recorded outcome without a re-read. `conflict` for
 * both of api's refusals — a second answer, and an answer on a referral nobody asked — and they are
 * distinguishable only by their prose, so nothing above here may branch on the message.
 *
 * Recording moves no case state and no case date: it writes the four confirmation columns, a case note, and
 * the case's `awaitingConfirmationSince`, which is how the case leaves the awaiting-confirmation worklist.
 */
export function recordConfirmation(caseId: string, referralId: string, confirmation: RecordConfirmation, config: ApiConfig): Promise<ApiResult<Referral>> {
  return request(config, "POST", `${referralPath(caseId, referralId)}/confirmation`, WIRE_SCHEMAS.ReferralResponse, confirmation);
}

/**
 * Everything the Email tab needs, in one call: what may be sent, what has been sent, and the pre-populated
 * slot values for each sendable template.
 *
 * One call and not three, which is api's own answer to this repo's performance rule — and it is load-bearing
 * beyond the tab: the per-email content page reads from this same payload rather than making a call of its own,
 * and the compose form opens with `slotDefaults` rather than spending a Notify call on `previewEmail` merely to
 * discover the judge's words.
 *
 * `availability` carries **every** template api knows about rather than only the sendable ones, each with the
 * sentence saying why it is not sendable, so a tab can answer "why can I not send the refusal letter" before it
 * is asked. `provisioned` is the separate question of whether the environment has a real Notify template behind
 * the key, and neither flag implies the other.
 */
export function getCaseEmails(caseId: string, config: ApiConfig): Promise<ApiResult<CaseEmails>> {
  return request(config, "GET", emailsPath(caseId), WIRE_SCHEMAS.CaseEmailsResponse);
}

/**
 * The email as GOV.UK Notify renders it, from the slot text the caseworker has typed so far. Writes nothing.
 *
 * A `POST` for a read, which is api's shape rather than a mistake: the input is the caseworker's prose, and a
 * URL would log it.
 *
 * **Every call spends one of Notify's rate-limited API calls, and that allowance is shared with real sends**, so
 * this belongs behind an explicit action and never behind a keystroke — decision 9 of
 * `docs/plans/notify-2-caseworker-email-tab.md`. `unavailable` covers api's 502 for a template Notify will not
 * render, which is what an unprovisioned environment answers; `availability[].provisioned` is how a tab knows
 * that in advance instead.
 */
export function previewEmail(caseId: string, template: string, slots: EmailSlotsWrite, config: ApiConfig): Promise<ApiResult<EmailPreview>> {
  return request(config, "POST", `${emailTemplatePath(caseId, template)}/preview`, WIRE_SCHEMAS.EmailPreviewResponse, slots);
}

/**
 * Send the email: api freezes the recipient and the content into an outbox row and drains it immediately.
 *
 * **The slots in the body, the idempotency key in a header, and it is required of every template.** api's
 * notify-6 made `Idempotency-Key` a required header on this operation, so a call without one is a 400 before
 * anything is read — which is why the key is a parameter here rather than an option: an adapter that could
 * forget it would be a client that cannot send. It stays out of the **body** because `SendEmailRequest` sets
 * `additionalProperties: false`, so an extra property there is a 400 that names it. There is no per-template
 * branch: api requires it of the operation, so this requires it of itself.
 *
 * **The caller owns the key's identity and this function never mints one.** api persists it against the case
 * with a unique index on `("deedPollId", "requestId")`, so the key is what says "this is the same send again"
 * — a substitute generated here would make every retry a new send, which is the behaviour the header replaced.
 *
 * **A redundant second send is a SUCCESS, not a conflict.** api answers 200 with the original row's id and
 * `enqueued: false`, both for a repeat of this key and for a case already owed this email; telling a caseworker
 * their email failed would invite a third attempt. `conflict` means something else — the case is in no state to
 * send this email (for the one shipped template, no Master has refused the application), or this key was used
 * for *different* content, which is a resubmission of a journey whose wording has since changed.
 *
 * `validation` covers both of api's refusals of content: its 400 naming each offending slot, and its 422 for a
 * case with no `applicantEmail` to send to, which names that column so a tab can say whose address is missing.
 */
export function sendEmail(caseId: string, template: string, slots: EmailSlotsWrite, idempotencyKey: string, config: ApiConfig): Promise<ApiResult<SentEmail>> {
  return request(config, "POST", emailTemplatePath(caseId, template), WIRE_SCHEMAS.SentEmailResponse, slots, {
    "idempotency-key": idempotencyKey
  });
}

/**
 * The caller's saved-query library: every shared query plus their own, each flagged `selected` and
 * `editable`.
 *
 * Shared-or-mine rather than selected-only, because this is what a "browse and add one" screen reads. A
 * navigation bar renders the subset where `selected` is true, which is a filter over data already held
 * rather than a second call.
 */
export function listSavedQueries(config: ApiConfig): Promise<ApiResult<SavedQuery[]>> {
  return request(config, "GET", "/caseworker/saved-queries", WIRE_SCHEMAS.SavedQueryResponse.array());
}

/**
 * One saved query, if it is shared or the caller's own.
 *
 * A query that is neither answers `not-found`, identically to an id that never existed — api makes the two
 * indistinguishable on purpose, so no id is discoverable by watching status codes. A caller cannot tell
 * "somebody else's private query" from "no such query", and neither can this app.
 */
export function getSavedQuery(id: string, config: ApiConfig): Promise<ApiResult<SavedQuery>> {
  return request(config, "GET", savedQueryPath(id), WIRE_SCHEMAS.SavedQueryResponse);
}

/** Save a new query, owned by the caller. The owner comes from the token, so it is not a parameter. */
export function createSavedQuery(query: SavedQueryCreate, config: ApiConfig): Promise<ApiResult<SavedQuery>> {
  return request(config, "POST", "/caseworker/saved-queries", WIRE_SCHEMAS.SavedQueryResponse, query);
}

/**
 * Amend a saved query — the owner, or an Administrator if it is shared.
 *
 * An omitted field is left as stored and an **explicit null clears the column**, which is unlike
 * `patchNote` and `updateWitness`: no column of theirs is nullable, so api answers 400 for a null there.
 * `JSON.stringify` drops an undefined property, so "omit" and "clear" stay distinguishable on the wire.
 */
export function patchSavedQuery(id: string, patch: SavedQueryPatch, config: ApiConfig): Promise<ApiResult<SavedQuery>> {
  return request(config, "PATCH", savedQueryPath(id), WIRE_SCHEMAS.SavedQueryResponse, patch);
}

/**
 * Delete a saved query. 204, so there is nothing to parse.
 *
 * Permitted even where others have selected it, and their selections go with it through api's foreign-key
 * cascade. Deleting twice is `not-found` on the second call, unlike unselecting twice — absence of shared
 * state is worth reporting where absence of the caller's own preference is not.
 */
export function deleteSavedQuery(id: string, config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "DELETE", savedQueryPath(id));
}

/**
 * Add a query to the caller's own list. Idempotent: a second call is another 204, not a conflict.
 *
 * `PUT` rather than `POST` because the request states an end state — this query is in my list — which is
 * true however many times it is sent, so a client retrying a lost response is never told it has a duplicate
 * to clean up. Permitted on somebody else's *shared* query, which is what the library is for, and refused
 * with `not-found` on one the caller cannot see: selecting must not become a way to discover a private query.
 */
export function selectSavedQuery(id: string, config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "PUT", `${savedQueryPath(id)}/selection`);
}

/**
 * Remove a query from the caller's own list. 204 whether or not it was in it.
 *
 * **Also 204 for a query the caller cannot see**, which is api's deliberate asymmetry with
 * {@link selectSavedQuery}: the row is keyed by the caller, so the delete cannot reach anybody else's, and
 * requiring visibility would trap a subscriber holding a stale selection for a query its owner has since
 * unshared — the one selection they most need to clear and the one they can no longer see. **Do not add a
 * visibility check before calling this.**
 */
export function deselectSavedQuery(id: string, config: ApiConfig): Promise<ApiResult<void>> {
  return requestNoContent(config, "DELETE", `${savedQueryPath(id)}/selection`);
}

/**
 * One page of the shared judicial pool: the referrals waiting to be picked up, urgent first then
 * longest-waiting.
 *
 * The five judicial operations are a sibling namespace to the caseworker surface rather than a section of it,
 * which is why none of them takes a case id: api keys the judicial surface on the referral so a judge cannot
 * name an application, and the case is resolved from the referral at api's end. The role that reaches these
 * routes is api's to enforce — this adapter presents the same bearer token it presents everywhere.
 *
 * `page` and `size` publish as strings, because api binds both as `String` and parses them itself: it refuses
 * what it cannot understand and clamps an over-cap `size` rather than refusing it. Omitting either lets api
 * apply its own default, as the case list does.
 */
export function getJudicialPool(query: JudicialPoolQuery, config: ApiConfig): Promise<ApiResult<JudicialPool>> {
  const parameters = new URLSearchParams();
  if (query.page !== undefined) parameters.set("page", String(query.page));
  if (query.size !== undefined) parameters.set("size", String(query.size));

  const search = parameters.toString();

  return request(config, "GET", `/judicial/referrals${search === "" ? "" : `?${search}`}`, WIRE_SCHEMAS.JudicialPoolResponse);
}

/**
 * One page of the referrals this judge has in hand: the ones they are holding, and the directions the office has
 * not yet actioned.
 *
 * **`/mine` is a literal path segment and not a query parameter, and that is the security decision.** A
 * `?claimedBy=` would make whose list this is something a caller types, and a judge who typed a colleague's would
 * be enumerating their work — which is what every 404 on this surface exists to prevent. Ownership comes from the
 * token's subject, so this function takes nothing identifying a judge and there is nothing to forge.
 *
 * It is also why this call sits **above** {@link getJudicialReferral} in every router that dispatches it: the
 * literal segment must win over the `{referralId}` template, or the word is read as a referral id and answers
 * `not-found` for a page that exists. Spring resolves that by specificity; this adapter's paths are built here, so
 * the ordering that matters is the mock's (`referrals-admin-6` decision 6).
 *
 * `page` and `size` are the pool's, encoded the same way and defaulting to api's same ten: the same dashboard and
 * the same screenful.
 *
 * **No `not-found` and no membership surprises.** The collection always exists, so a judge holding nothing is an
 * empty page and a total of zero rather than a refusal; `unauthorized` is api's answer to a judicial token
 * carrying no subject, because an unidentified caller owns nothing and has no list.
 */
export function getJudicialMyReferrals(query: JudicialPoolQuery, config: ApiConfig): Promise<ApiResult<JudicialMyReferrals>> {
  const parameters = new URLSearchParams();
  if (query.page !== undefined) parameters.set("page", String(query.page));
  if (query.size !== undefined) parameters.set("size", String(query.size));

  const search = parameters.toString();

  return request(config, "GET", `/judicial/referrals/mine${search === "" ? "" : `?${search}`}`, WIRE_SCHEMAS.JudicialMyReferralsResponse);
}

/**
 * One referral as the judge who may see it reads it: the referral, the application with its witnesses and
 * documents, and the application's timeline, in one call because they are one screen.
 *
 * `not-found` for a referral this judge may not see — an `Open` one is visible to any of them, a claimed or
 * decided one only to its holder — and indistinguishable from an id that never existed, so no referral is
 * discoverable by watching status codes.
 */
export function getJudicialReferral(referralId: string, config: ApiConfig): Promise<ApiResult<JudicialReferralDetail>> {
  return request(config, "GET", judicialReferralPath(referralId), WIRE_SCHEMAS.JudicialReferralDetail);
}

/**
 * Pick a referral up out of the pool. No body — the sub-resource names the transition and the holder comes
 * from the token.
 *
 * `conflict` when the referral is not `Open` — but api checks visibility first, so this is **not** what a second
 * judge gets for claiming one that has just been taken: that is a `not-found`, indistinguishable from withdrawn,
 * closed and never-there. The only referral a caller can see and not claim is one they hold or have decided
 * themselves, so a `conflict` here says "already yours" and never "somebody else's".
 */
export function claimJudicialReferral(referralId: string, config: ApiConfig): Promise<ApiResult<JudicialReferralDetail>> {
  return request(config, "POST", `${judicialReferralPath(referralId)}/claim`, WIRE_SCHEMAS.JudicialReferralDetail);
}

/**
 * Record the direction on a referral this judge holds. One call and complete: api has no draft and no patch.
 *
 * `conflict` when the caller is not the current holder, which covers a referral withdrawn under them and one
 * taken back by api's inactivity sweep — both are a referral that moved on, not a late direction.
 */
export function directJudicialReferral(referralId: string, direction: JudicialDirection, config: ApiConfig): Promise<ApiResult<JudicialReferralDetail>> {
  return request(config, "POST", `${judicialReferralPath(referralId)}/direction`, WIRE_SCHEMAS.JudicialReferralDetail, direction);
}

/**
 * Replace the direction this judge gave, while the referral is `Decided` and before the office closes it. The
 * body is {@link directJudicialReferral}'s, refused in the same words.
 *
 * `conflict` for a visible referral that is not this judge's direction — one in the pool, or their own claim not
 * yet directed — and `not-found` once it is closed, so neither refusal can say anyone else directed it. api keeps
 * the earlier direction on its audit trail, writes the caseworker a case note and sets `directionChangedAt`.
 */
export function reviseDirection(referralId: string, direction: JudicialDirection, config: ApiConfig): Promise<ApiResult<JudicialReferralDetail>> {
  return request(config, "PUT", `${judicialReferralPath(referralId)}/direction`, WIRE_SCHEMAS.JudicialReferralDetail, direction);
}

/**
 * Take back the direction this judge gave so they can direct again. No body. The referral returns to `Claimed`,
 * held by the same judge with the direction cleared, and is directed again with {@link directJudicialReferral}.
 *
 * The refusals are {@link reviseDirection}'s. A withdrawn direction is a live claim again, so api's inactivity
 * sweep may return it to the pool if it is not directed.
 */
export function withdrawDirection(referralId: string, config: ApiConfig): Promise<ApiResult<JudicialReferralDetail>> {
  return request(config, "POST", `${judicialReferralPath(referralId)}/direction/withdraw`, WIRE_SCHEMAS.JudicialReferralDetail);
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

function referralPath(caseId: string, referralId: string): string {
  return `/caseworker/cases/${encodeURIComponent(caseId)}/referrals/${encodeURIComponent(referralId)}`;
}

function emailsPath(caseId: string): string {
  return `/caseworker/cases/${encodeURIComponent(caseId)}/emails`;
}

/**
 * One email type of one case, addressed by api's template key.
 *
 * Encoded like every other path segment, even though the keys are kebab-case literals: the value reaching here
 * is a route parameter a caseworker's URL supplied, so it is treated as text rather than as a key that has
 * already been checked. api matches it exactly and answers 404 naming the keys it would have taken.
 */
function emailTemplatePath(caseId: string, template: string): string {
  return `${emailsPath(caseId)}/${encodeURIComponent(template)}`;
}

/** No case id, because api's judicial routes take none — see {@link getJudicialPool}. */
function judicialReferralPath(referralId: string): string {
  return `/judicial/referrals/${encodeURIComponent(referralId)}`;
}

function savedQueryPath(id: string): string {
  return `/caseworker/saved-queries/${encodeURIComponent(id)}`;
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
 *
 * `headers` is for a header the operation itself requires — today only the send's `Idempotency-Key`. Names are
 * written lower-case like the three `send` sets itself, which changes nothing on the wire: HTTP header names are
 * case-insensitive and `fetch` lower-cases them anyway, so this reaches api's `@RequestHeader("Idempotency-Key")`.
 * It cannot displace `accept`, `authorization` or `content-type` — see the spread order in `send`.
 */
async function request<S extends z.ZodType>(
  config: ApiConfig,
  method: string,
  path: string,
  schema: S,
  body?: unknown,
  headers?: Record<string, string>
): Promise<ApiResult<z.infer<S>>> {
  const sent = await send(config, method, path, body, "application/json", false, headers);
  if (!sent.ok) return sent;

  return parseResponse(sent.response, schema, method, path);
}

async function parseResponse<S extends z.ZodType>(response: Response, schema: S, method: string, path: string): Promise<ApiResult<z.infer<S>>> {
  const operation = `${method} ${withoutQuery(path)}`;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    // A read the timeout cut short is a slow api, not a contract breach. `invalid-response` means "a bug at
    // one end or the other" and is the thing an operator is meant to investigate rather than dismiss, so
    // reporting a stall as one sends them hunting a defect when the answer is that api stopped talking.
    if (isAborted(error)) return { ok: false, error: transportError(error) };

    return { ok: false, error: { kind: "invalid-response", status: response.status, message: `${operation} returned a body that is not JSON` } };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // The issue PATHS, never the values: a rejected body is the applicant's own data coming back.
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    return {
      ok: false,
      error: { kind: "invalid-response", status: response.status, message: `${operation} returned an unexpected shape (${fields})` }
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * The path a diagnostic may name: everything before the query or fragment.
 *
 * A list's query carries the caseworker's search text and field conditions — applicant names — and this message
 * reaches a log via `callApi`. Cut by position rather than by parameter name, so a parameter added later is left
 * out too. Ids are already percent-encoded segments, so a `?` in one cannot end the path early.
 */
function withoutQuery(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
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
async function send(
  config: ApiConfig,
  method: string,
  path: string,
  body: unknown,
  accept: string,
  streaming = false,
  headers?: Record<string, string>
): Promise<SendResult> {
  const result = await exchange(config, method, path, body, accept, streaming, headers);
  if (!result.ok || result.response.ok) return result;
  return { ok: false, error: await failureFromResponse(result.response) };
}

async function gazetteRequest<S extends z.ZodType>(
  config: ApiConfig,
  path: string,
  schema: S,
  body: unknown,
  key?: string
): Promise<GazetteApiResult<z.infer<S>>> {
  const result = await exchange(config, "POST", path, body, "application/json", false, key === undefined ? undefined : { "idempotency-key": key });
  if (!result.ok) return result;
  const response = result.response;
  if (response.ok) return parseResponse(response, schema, "POST", path);
  const payload = await readJsonOrNull(response);
  const refusal = WIRE_SCHEMAS.GazetteError.safeParse(payload);
  if (
    refusal.success &&
    ((response.status === 409 && refusal.data.code !== "GAZETTE_UNAVAILABLE") || (response.status === 503 && refusal.data.code === "GAZETTE_UNAVAILABLE"))
  ) {
    return { ok: false, error: { kind: "gazette-refusal", code: refusal.data.code, conflicts: refusal.data.conflicts ?? [] } };
  }
  return { ok: false, error: classifyFailure(response, payload) };
}

async function exchange(
  config: ApiConfig,
  method: string,
  path: string,
  body: unknown,
  accept: string,
  streaming = false,
  headers?: Record<string, string>
): Promise<SendResult> {
  // Startup validates the app's URL; direct adapter consumers must receive the same protection.
  assertApiBaseUrl(config.baseUrl);
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
        // The operation's own headers go FIRST so the three this function owns win: `authorization` is the
        // caller's identity and a per-operation name that collided with it would produce unauthenticated
        // calls nothing but a deployed environment would reveal.
        headers: {
          ...headers,
          accept,
          ...(config.accessToken === undefined ? {} : { authorization: `Bearer ${config.accessToken}` }),
          ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {})
        },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
        signal: controller?.signal ?? AbortSignal.timeout(timeoutMs),
        // Never forward a token or request body to a redirect target, including an HTTP downgrade.
        redirect: "error"
      });
    } catch (error) {
      return { ok: false, error: transportError(error) };
    }

    // Keep a streaming failure-body read inside the cancellable timeout, before finally clears it.
    if (!response.ok && streaming) return { ok: false, error: await failureFromResponse(response) };
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
  return classifyFailure(response, payload);
}

function classifyFailure(response: Response, payload: unknown): ApiError {
  const status = response.status;
  const parsed = WIRE_SCHEMAS.ApiError.safeParse(payload);
  const message = parsed.success ? parsed.data.error : `deed-poll-api answered ${status}`;
  const fieldErrors = parsed.success ? (parsed.data.errors ?? []) : [];

  // 413 and 415 sit with 400: a file api judges too large or of a type it will not take is the
  // caseworker's input, not a fault. Left as `unknown` they became a plain `Error` and the 500 page,
  // which is the trap `upload-policy.ts` documents — telling someone the service has broken when in
  // fact their file was refused. `upload-policy.ts` rejects both locally first, but its size limit is
  // this repo's guess and api's is api's, so the window between the two is reachable.
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return { kind: "validation", status, message, fieldErrors };
  }
  if (status === 401) return { kind: "unauthorized", status, message };
  if (status === 403) return { kind: "forbidden", status, message };
  if (status === 404) return { kind: "not-found", status, message };
  if (status === 409) return { kind: "conflict", status, message };

  // api's abuse limiter, not an outage: the caseworker is told how long to wait rather than that the
  // service has broken.
  if (status === 429) return { kind: "rate-limited", status, message, retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")) };

  // 408 sits with the 5xxs: all of them mean "come back shortly", not "your input is wrong".
  if (status === 408 || status >= 500) {
    return { kind: "unavailable", status, message };
  }

  return { kind: "unknown", status, message };
}

/**
 * `Retry-After` as whole seconds, which is the only form api sends. The HTTP-date form, a fraction or a
 * negative are read as "not known" rather than guessed at, so the page falls back to its generic sentence.
 */
function retryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  const seconds = Number(header.trim());
  return Number.isSafeInteger(seconds) ? seconds : null;
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
 * - `rate-limited` — api's abuse limiter refused this caller; `retryAfterSeconds` says for how long, or
 *   `null` when api did not say in a form this reads
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
  /** Set for `rate-limited` only. */
  retryAfterSeconds?: number | null;
}

export type ApiErrorKind =
  | "validation"
  | "not-found"
  | "forbidden"
  | "unauthorized"
  | "conflict"
  | "rate-limited"
  | "unavailable"
  | "timeout"
  | "invalid-response"
  | "unknown";

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
export type GazetteNoticeHistory = WireGazetteNoticeHistory;
export type GazetteNoticeBatch = WireGazetteNoticeBatch;
export type Note = WireNote;
export type Witness = WireCaseDetail["witnesses"][number];
export type WitnessCreate = WireWitnessCreate;
export type WitnessPatch = WireWitnessUpdate;
export type Document = WireDocument;
export type DocumentType = WireDocumentType;
export type FieldRules = WireFieldRules["rules"];
export type FieldRule = FieldRules[string];
export type CaseWrite = WireCaseWrite;
export type SavedQuery = WireSavedQuery;
export type SavedQueryCreate = WireSavedQueryCreate;
export type SavedQueryPatch = WireSavedQueryUpdate;
export type Referral = WireReferral;
export type ReferralCreate = WireReferralCreate;
/**
 * The applicant's answer as it goes OUT, so `z.input`: `note` is optional, and the two fields api derives from
 * the token and its own clock are absent from the type as well as from the schema.
 */
export type RecordConfirmation = WireRecordConfirmation;
/**
 * The judicial read types, which are a separate vocabulary from the caseworker ones rather than narrower
 * versions of them — api publishes different records, and `JudicialApplicationView` is deliberately not a subset of a
 * case (see `wire.ts`).
 */
export type JudicialPool = WireJudicialPool;
/**
 * Its own type beside `JudicialPool` and not an alias of it, because api publishes two records: the two carry the
 * same five properties and name opposite collections — the shared pool, and one judge's own work.
 */
export type JudicialMyReferrals = WireJudicialMyReferrals;
export type JudicialReferralSummary = WireJudicialReferralSummary;
export type JudicialReferralDetail = WireJudicialReferralDetail;
export type JudicialApplicationView = WireJudicialApplicationView;
export type JudicialWitness = WireJudicialWitness;
export type JudicialDocument = WireJudicialDocument;
export type JudicialCaseNote = WireJudicialCaseNote;
export type JudicialDirection = WireJudicialDirection;
/**
 * The email types, which are one payload's parts rather than five endpoints' worth: `CaseEmails` is what the tab
 * reads and the other four are the shapes inside it.
 *
 * `EmailSlot` is the METADATA of a field a caseworker fills — its name, its cap and whether it is required —
 * where `EmailSlotsWrite` is the values. Two types for what sounds like one thing, because api publishes them
 * separately and for a reason: the metadata is what a form is built from, and the values are the only part of an
 * email this app may set.
 */
export type CaseEmails = WireCaseEmails;
export type EmailType = WireEmailType;
export type EmailSlot = WireEmailSlot;
export type EmailSlotDefaults = WireEmailSlotDefaults;
export type EmailHistory = WireEmailHistory;
export type CorrespondenceDocument = WireCorrespondenceDocument;
export type EmailPreview = WireEmailPreview;
export type SentEmail = WireSentEmail;
/**
 * The slots as they go OUT, so `z.input` — and the keys are **`snake_case`**, which is this module's one
 * documented exception to "the wire is camelCase".
 *
 * They are GOV.UK Notify placeholder names, which makes each one the personalisation key and the request-body
 * key at once. Renaming one anywhere above this line is the mistake no test here catches: `additionalProperties:
 * false` means api names an unknown key in a 400, but a *renamed* key is simply a slot that was never sent, so
 * Notify substitutes nothing and the applicant reads the template with an empty quotation in it.
 */
export type EmailSlotsWrite = WireEmailSlotsWrite;
/** The outbox states, as the member union. See `NOTIFY_STATE` for what `Sent` may and may not be said to mean. */
export type NotifyState = NonNullable<EmailHistory["notifyState"]>;

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
export type ReferralState = NonNullable<Referral["state"]>;
/**
 * Derived from the create body rather than the response: api publishes a referral's stored `reasons` as plain
 * strings, because the column is a JSON array it validates on write, so the membership is only declared on the
 * way in. A page rendering a stored reason is therefore rendering a string, and one offering the choices is
 * offering these.
 */
export type ReferralReason = ReferralCreate["reasons"][number];
export type ReferralDecision = JudicialDirection["decision"];
/**
 * The applicant's two possible answers, from the **response** rather than from the request body.
 *
 * Either would do — api publishes the same two members inline on both — and the response is the one every
 * reader of a referral already holds, so a page rendering a recorded outcome and a form offering the choices
 * annotate with one type.
 */
export type ConfirmationOutcome = NonNullable<Referral["confirmationOutcome"]>;

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
  /**
   * A free-text search term, ANDed with `filter` and `where`.
   *
   * api ORs it across six name fields and the reference number, matching a substring rather than fuzzily,
   * and truncates a term beyond 100 characters instead of refusing it. Which fields those are and what
   * counts as a reference are api's rules, not repeated here — a `referenceMatch` on the response is how it
   * reports an exact reference hit.
   */
  q?: string;
  /** Conditions as `field:operator:value`, ANDed. api caps them at 20 and refuses the request beyond that. */
  where?: readonly string[];
  /** `field` or `field:asc` or `field:desc`. Omitted is newest first. */
  sort?: string;
  /** 1-based. */
  page?: number;
  /** Rows per page. api defaults to 25 and clamps anything above 100 to 100. */
  size?: number;
}

/**
 * Which page of a judicial list to read — the shared pool's, and the caller's own.
 *
 * No filter, no sort and no search: each list is one queue in one order api fixes — the pool urgent-first then
 * longest-waiting, the personal list unfinished work first — so a judge choosing their next piece of work is
 * choosing from the top rather than composing a query.
 *
 * **One type for both, and deliberately no owner field.** api takes the same two parameters on each and parses
 * them with the same `CasePaging`, so a second identical interface would be one more to keep in step. What must
 * never be added is a judge: whose list `/judicial/referrals/mine` returns comes from the token, and a property
 * here would be a way to ask for somebody else's — see {@link getJudicialMyReferrals}.
 */
export interface JudicialPoolQuery {
  /** 1-based. */
  page?: number;
  /** Rows per page. api defaults to 10 and clamps an over-cap value rather than refusing it. */
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

/** History has no custom filter or sort. Its order and membership belong to api. */
export interface GazetteNoticeHistoryQuery {
  /** 1-based; defaults to 1 at api. */
  page?: number;
  /** Defaults to 25; api clamps to 100. */
  size?: number;
}

export type CallerAccess = WireCallerAccess;
export type Capability = CallerAccess["capabilities"][number];
export type GazetteSettings = WireGazetteSettings;
export type UpdateGazetteSettings = WireUpdateGazetteSettings;

export { GAZETTE_RECIPIENT_EMAIL_PATTERN } from "./wire.js";

export type GazettePreview = WireGazettePreview;
export type GazetteStatus = WireGazetteStatus;
export type GazetteRequests = WireGazetteRequests;
export type GazetteMembers = WireGazetteMembers;
export type PreviewGazette = WirePreviewGazette;
export type SubmitGazette = WireSubmitGazette;
export type GazetteRefusalCode = WireGazetteError["code"];
export interface GazetteRefusal {
  kind: "gazette-refusal";
  code: GazetteRefusalCode;
  conflicts: NonNullable<WireGazetteError["conflicts"]>;
}
export type GazetteApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError | GazetteRefusal };
export interface GazetteRequestsQuery extends GazetteNoticeHistoryQuery {
  state?: GazetteStatus["state"];
}
export { GAZETTE_REQUEST_STATE } from "./wire.js";
