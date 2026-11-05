import {
  getMiCompletion,
  getMiReferralOutcomes,
  getMiStageDurations,
  getMiVolume,
  type ManagementInformationQuery,
  type MiCompletion,
  type MiGranularity,
  type MiReferralOutcomes,
  type MiStageDurations,
  type MiStageInterval,
  type MiVolume
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

export function findMiVolume(query: ManagementInformationQuery, caller: Caller): Promise<MiVolume> {
  return callApi(caller, (config) => getMiVolume(query, config));
}

export function findMiStageDurations(query: ManagementInformationQuery, caller: Caller): Promise<MiStageDurations> {
  return callApi(caller, (config) => getMiStageDurations(query, config));
}

export function findMiReferralOutcomes(query: ManagementInformationQuery, caller: Caller): Promise<MiReferralOutcomes> {
  return callApi(caller, (config) => getMiReferralOutcomes(query, config));
}

export function findMiCompletion(query: ManagementInformationQuery, caller: Caller): Promise<MiCompletion> {
  return callApi(caller, (config) => getMiCompletion(query, config));
}

export { MI_STAGE_INTERVAL } from "@hmcts/deed-poll-api-client";
export type { ManagementInformationQuery, MiCompletion, MiGranularity, MiReferralOutcomes, MiStageDurations, MiStageInterval, MiVolume };
