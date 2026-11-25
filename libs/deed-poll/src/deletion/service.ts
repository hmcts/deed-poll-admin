/**
 * Application deletion (api#175, `docs/APPLICATION-DELETION.md`): admit, read and restore, and no rules of their own.
 * api owns permission, eligibility, idempotency and the audit, which it stamps from the caller's token.
 *
 * **The key is the caller's and is never minted here**, as for `sendCaseEmail`: it identifies the confirmation
 * journey, so a key made here would turn every retry into a second request. **An admission without a definite answer
 * is `DeletionOutcomeUnknownError`**, never a plain `Error`, because api may have admitted it and the only safe next
 * step is the same request again. A 202 is admitted, not deleted: only a status of `Completed` is a deletion.
 */
import {
  type DeletionAdmission,
  type DeletionCreate,
  type DeletionRestore,
  type DeletionStatusResponse,
  getApplicationDeletion,
  requestApplicationDeletion,
  restoreApplicationDeletion
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi, callDeletionAdmissionApi } from "../api/deed-poll-api.js";

export function requestDeletion(caseId: string, body: DeletionRequestBody, idempotencyKey: string, caller: Caller): Promise<DeletionAdmission> {
  // Copied field by field so nothing beside api's three fields (an asserted author, say) can travel.
  const { reason, note, expectedLastChangedOn } = body;
  return callDeletionAdmissionApi(caller, (config) => requestApplicationDeletion(caseId, { reason, note, expectedLastChangedOn }, idempotencyKey, config));
}

/** Reads only the request, so it answers after the application is gone. */
export function findDeletion(requestId: string, caller: Caller): Promise<DeletionStatusResponse> {
  return callApi(caller, (config) => getApplicationDeletion(requestId, config));
}

export function restoreDeletion(requestId: string, caller: Caller): Promise<DeletionRestore> {
  return callApi(caller, (config) => restoreApplicationDeletion(requestId, config));
}

/** api's admission body; `expectedLastChangedOn` is the case detail's `lastChangedOn` exactly as api published it. */
export type DeletionRequestBody = DeletionCreate;
