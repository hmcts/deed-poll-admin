import { type CaseList, type GazetteNoticeHistory, type GazetteNoticeHistoryQuery, getGazetteNoticeHistory, listCases } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

export const READY_FOR_PUBLICATION_FILTER = "readyForPublication";

/** API owns membership and order. Copy only paging so a bookmarked sort cannot override its default. */
export function findGazetteReadyCases(paging: GazetteNoticeHistoryQuery, caller: Caller): Promise<CaseList> {
  return callApi(caller, (config) => listCases({ filter: READY_FOR_PUBLICATION_FILTER, page: paging.page, size: paging.size }, config));
}

export async function countGazetteReadyCases(caller: Caller): Promise<number> {
  return (await findGazetteReadyCases({ size: 1 }, caller)).total;
}

export function findGazetteHistory(paging: GazetteNoticeHistoryQuery, caller: Caller): Promise<GazetteNoticeHistory> {
  return callApi(caller, (config) => getGazetteNoticeHistory({ page: paging.page, size: paging.size }, config));
}
