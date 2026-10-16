/**
 * A per-pod cap on uploads being parsed at once (OWASP plan 06, M6).
 *
 * Multer holds each file in memory up to `MAX_UPLOAD_BYTES`, so the per-user limiter alone still lets enough users
 * at once exhaust one pod. This bounds that, and it enforces whatever `rateLimit.mode` says: it protects this app's
 * own memory, which api's limit cannot.
 *
 * The count lives in the closure rather than at module scope so each `createApp` gets its own; a pod builds one.
 * A slot is released on `finish` **and** on `close`, once: an upload the client abandons fires only `close`, and one
 * that completes fires both.
 */
import { TooManyRequestsError } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const RETRY_AFTER_SECONDS = 5;

export function uploadInFlightCap(max: number): RequestHandler {
  let inFlight = 0;

  return (_req: Request, res: Response, next: NextFunction) => {
    if (inFlight >= max) {
      return next(new TooManyRequestsError(`Upload in-flight cap of ${max} reached`, RETRY_AFTER_SECONDS));
    }

    // A client that dropped during earlier async middleware has already fired `close`, which will not fire again,
    // so counting it would hold the slot until the pod restarts.
    if (res.destroyed) {
      return next();
    }

    inFlight += 1;
    let isReleased = false;
    const release = () => {
      if (isReleased) return;
      isReleased = true;
      inFlight -= 1;
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
