/**
 * Permanent document deletion (api#179, `docs/DOCUMENT-DELETION.md` in api): admit and read, and no rules of their own.
 * api owns permission (any staff role that can open the case, never a judge), the active-use and storage checks, the
 * version check, idempotency, the audit event and the case note, which it writes from the caller's token. Nothing here
 * writes a note or an audit record, and nothing re-checks eligibility.
 *
 * **The key is the caller's and is never minted here**: it identifies the confirmation journey, so a key made here
 * would turn every retry into a second request. **An admission without a definite answer is
 * `DocumentDeletionOutcomeUnknownError`**, never a plain `Error`, because api may have admitted it. api deletes while
 * the caller waits, so the answer is usually `Completed`; `InProgress` and `NeedsAttention` are admitted, not deleted.
 */
import {
  getDocumentDeletion as apiGetDocumentDeletion,
  requestDocumentDeletion as apiRequestDocumentDeletion,
  type DocumentDeletionAdmission,
  type DocumentDeletionCreate,
  type DocumentDeletionStatusResponse
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi, callDocumentDeletionAdmissionApi } from "../../api/deed-poll-api.js";

export function requestDocumentDeletion(
  caseId: string,
  documentId: string,
  body: DocumentDeletionRequestBody,
  idempotencyKey: string,
  caller: Caller
): Promise<DocumentDeletionAdmission> {
  // Copied field by field so nothing beside api's two fields (an asserted author, say) can travel.
  const { reason, expectedDocumentVersion } = body;
  return callDocumentDeletionAdmissionApi(caller, (config) =>
    apiRequestDocumentDeletion(caseId, documentId, { reason, expectedDocumentVersion }, idempotencyKey, config)
  );
}

/** Reads only the request, under its case, so it answers after the document is gone. A read never retries the work. */
export function findDocumentDeletion(caseId: string, requestId: string, caller: Caller): Promise<DocumentDeletionStatusResponse> {
  return callApi(caller, (config) => apiGetDocumentDeletion(caseId, requestId, config));
}

/** api's admission body; `expectedDocumentVersion` is the case detail's `documentVersion` exactly as api published it. */
export type DocumentDeletionRequestBody = DocumentDeletionCreate;
