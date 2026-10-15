import { getCallerAccess } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import { type CallerAccess, callerAccessFrom } from "./capabilities.js";

/**
 * What api's `GET /me` says the token's holder may do, which api resolves from AM rather than from IDAM roles.
 *
 * Throws the domain error a failed call amounts to, like every other read here: what a failure means differs by
 * caller (no access at sign-in, the previous answer at a refresh), so that decision is theirs.
 */
export async function findCallerAccess(caller: Caller): Promise<CallerAccess> {
  return callerAccessFrom(await callApi(caller, (config) => getCallerAccess(config)));
}
