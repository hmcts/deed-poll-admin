/**
 * IDAM's end-session address, or `undefined` when it cannot be had right now (review finding R04, plan
 * `docs/plans/completed/20261021-r04-timeout-during-idam-outage.md`).
 *
 * Asked only after the session has been ended here. A discovery failure, including the cooldown that follows one, is
 * treated like an issuer that advertises no end-session endpoint: the local end is already done, so the caller falls
 * back to its own page rather than answering 500 and leaving the ending half finished. The log line is fixed: the
 * error would carry IDAM's response, and the URL the id token.
 */
import { endSessionUrl, type IdamConfig } from "./idam.js";

export async function availableEndSessionUrl(config: IdamConfig, idToken: string | undefined, postLogoutPath?: string): Promise<string | undefined> {
  try {
    return await endSessionUrl(config, idToken, postLogoutPath);
  } catch {
    console.warn("IDAM end-session address unavailable; the session was ended locally only");
    return undefined;
  }
}
