import {
  type CaseList,
  type CaseListQuery,
  type GazetteMembers,
  type GazetteNoticeHistory,
  type GazetteNoticeHistoryQuery,
  type GazettePreview,
  type GazetteRequests,
  type GazetteRequestsQuery,
  type GazetteSettings,
  type GazetteStatus,
  getGazetteMembers,
  getGazetteNoticeHistory,
  getGazetteRequests,
  getGazetteSettings,
  getGazetteStatus,
  listCases,
  previewGazetteNotice,
  type SubmitGazette,
  submitGazetteNotice,
  type UpdateGazetteSettings,
  updateGazetteSettings
} from "@hmcts/deed-poll-api-client";
import { type Caller, type CallLimit, callApi, callGazetteApi } from "../api/deed-poll-api.js";

export const READY_FOR_PUBLICATION_FILTER = "readyForPublication";

/** API owns membership and order. Copy only paging so a bookmarked sort cannot override its default. */
export function findGazetteReadyCases(paging: Pick<CaseListQuery, "page" | "size">, caller: Caller): Promise<CaseList> {
  return callApi(caller, (config) => listCases({ filter: READY_FOR_PUBLICATION_FILTER, page: paging.page, size: paging.size }, config));
}

export async function countGazetteReadyCases(caller: Caller): Promise<number> {
  return (await findGazetteReadyCases({ size: 1 }, caller)).total;
}

export function findGazetteHistory(paging: GazetteNoticeHistoryQuery, caller: Caller): Promise<GazetteNoticeHistory> {
  return callApi(caller, (config) => getGazetteNoticeHistory({ page: paging.page, size: paging.size }, config));
}

export function findGazetteSettings(caller: Caller): Promise<GazetteSettings> {
  return callApi(caller, (config) => getGazetteSettings(config));
}

export function saveGazetteSettings(input: UpdateGazetteSettings, caller: Caller): Promise<GazetteSettings> {
  return callApi(caller, (config) => updateGazetteSettings(input, config));
}

export function findGazetteRequests(query: GazetteRequestsQuery, caller: Caller): Promise<GazetteRequests> {
  return callApi(caller, (config) => getGazetteRequests({ page: query.page, size: query.size, state: query.state }, config));
}

export function findGazetteStatus(batchId: string, caller: Caller): Promise<GazetteStatus> {
  return callApi(caller, (config) => getGazetteStatus(batchId, config));
}

export function findGazetteMembers(batchId: string, paging: GazetteNoticeHistoryQuery, caller: Caller): Promise<GazetteMembers> {
  return callApi(caller, (config) => getGazetteMembers(batchId, { page: paging.page, size: paging.size }, config));
}

export function previewGazetteSelection(caseIds: string[], caller: Caller): Promise<GazettePreview> {
  return callGazetteApi(caller, (config) => previewGazetteNotice({ caseIds }, config));
}
/** `limit` is what is left of the page's deadline, so a send cannot outlast the gateway in front of the browser. */
export function sendGazetteSelection(input: SubmitGazette, key: string, caller: Caller, limit?: CallLimit): Promise<GazetteStatus> {
  return callGazetteApi(caller, (config) => submitGazetteNotice(input, key, config), limit);
}
