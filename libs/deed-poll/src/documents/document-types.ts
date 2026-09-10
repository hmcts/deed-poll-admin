/**
 * Supporting-document types — the list of things a document can be, with the marital statuses and case
 * types each applies to. Global reference data, not case data, which is why this is not nested.
 *
 * **Read-only, and one function.** api publishes `GET /caseworker/document-types` and nothing else:
 * task 4 of `docs/plans/completed/02-dal-cutover-to-api.md` records the absence of document-type writes as
 * deliberate, and `DEED_POLL_API_PLAN.md` lists them among the operations not rebuilt until something
 * asks. Nothing in this app asks — the only reader is the upload form's type dropdown — so the create,
 * patch and delete went rather than being left as routes that could only fail, and
 * `createDocumentTypeSchema`/`updateDocumentTypeSchema` with them.
 *
 * The in-use check that made the delete a 409 rather than a foreign-key 500 went too. It was a real
 * defect fix and it is not lost: the constraint it protected is api's database now, and enforcing it is
 * whoever rebuilds the delete's problem to solve on that side.
 *
 * There is no single-type read either. api has no `GET /caseworker/document-types/{id}`, and filtering
 * the list here to synthesise one would be inventing an operation the contract does not offer.
 */
import { type DocumentType, listDocumentTypes } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

/** Every document type, as api orders them — by name, which is the order the dropdown wants. */
export function findDocumentTypes(caller: Caller): Promise<DocumentType[]> {
  return callApi(caller, (config) => listDocumentTypes(config));
}
