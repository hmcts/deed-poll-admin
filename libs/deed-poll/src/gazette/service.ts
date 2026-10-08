import {
  type CaseList,
  type CaseListQuery,
  type GazetteNoticeHistory,
  type GazetteNoticeHistoryQuery,
  type GazetteSettings,
  getGazetteNoticeHistory,
  getGazetteSettings,
  listCases,
  type UpdateGazetteSettings,
  updateGazetteSettings
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

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
