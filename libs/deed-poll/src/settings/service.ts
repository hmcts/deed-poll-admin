import { getProcessSettings, type ProcessSettings, type UpdateProcessSettings, updateProcessSettings } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

export function findProcessSettings(caller: Caller): Promise<ProcessSettings> {
  return callApi(caller, (config) => getProcessSettings(config));
}

export function saveProcessSettings(input: UpdateProcessSettings, caller: Caller): Promise<ProcessSettings> {
  return callApi(caller, (config) => updateProcessSettings(input, config));
}
