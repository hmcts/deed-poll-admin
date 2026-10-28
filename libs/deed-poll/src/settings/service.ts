import {
  addBankHoliday,
  type BankHoliday,
  type BankHolidayCreate,
  createMaster,
  getProcessSettings,
  listBankHolidays,
  listMasters,
  type Master,
  type MasterCreate,
  type MasterUpdate,
  type ProcessSettings,
  removeBankHoliday,
  type UpdateProcessSettings,
  updateMaster,
  updateProcessSettings
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

export function findProcessSettings(caller: Caller): Promise<ProcessSettings> {
  return callApi(caller, (config) => getProcessSettings(config));
}

export function saveProcessSettings(input: UpdateProcessSettings, caller: Caller): Promise<ProcessSettings> {
  return callApi(caller, (config) => updateProcessSettings(input, config));
}

export function findMasters(caller: Caller): Promise<Master[]> {
  return callApi(caller, (config) => listMasters(config));
}

export function saveNewMaster(input: MasterCreate, caller: Caller): Promise<Master> {
  return callApi(caller, (config) => createMaster(input, config));
}

export function saveMasterChange(id: string, patch: MasterUpdate, caller: Caller): Promise<Master> {
  return callApi(caller, (config) => updateMaster(id, patch, config));
}

export function findBankHolidays(caller: Caller): Promise<BankHoliday[]> {
  return callApi(caller, (config) => listBankHolidays(config));
}

export function saveBankHoliday(input: BankHolidayCreate, caller: Caller): Promise<BankHoliday> {
  return callApi(caller, (config) => addBankHoliday(input, config));
}

export function deleteBankHoliday(date: string, caller: Caller): Promise<void> {
  return callApi(caller, (config) => removeBankHoliday(date, config));
}
