/**
 * Maps domain errors thrown out of route handlers onto JSON responses.
 *
 * The domain layer is framework-free and throws `NotFoundError` / `InvalidInputError` /
 * `ForbiddenError` (see `libs/deed-poll/src/errors.ts`). Something has to turn those into
 * status codes, and doing it once here rather than in a try/catch per handler means the 29
 * ported handlers cannot disagree about what a missing case returns — and a handler that
 * forgets to catch cannot leak a stack trace as a 500.
 *
 * Express 5 forwards a rejected promise from an async handler to error middleware, so
 * handlers can throw and rely on this. Express only recognises a middleware as an error
 * handler if it declares four parameters, hence the unused `_next`.
 */
import { ConflictError, type FieldError, ForbiddenError, InvalidInputError, NotFoundError, UnauthorizedError, zodErrorToFieldErrors } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

const GENERIC_MESSAGE = "Internal server error";

export function errorHandler() {
  return (err: Error, _req: Request, res: Response, next: NextFunction) => {
    // Past the point of changing the status, so let Express abort the response rather
    // than attempt a second set of headers.
    if (res.headersSent) {
      return next(err);
    }

    const mapped = mapError(err);

    if (!mapped) {
      // Deliberately not err.message: an unrecognised error is a bug, and its text may
      // carry internals the caller should not see.
      console.error("Unhandled error in API route:", err);
      return res.status(500).json({ error: GENERIC_MESSAGE });
    }

    if (mapped.headers) {
      res.set(mapped.headers);
    }

    res.status(mapped.status).json(mapped.body);
  };
}

function mapError(err: Error): MappedError | undefined {
  if (err instanceof ZodError) {
    return { status: 400, body: { error: "Validation failed", errors: zodErrorToFieldErrors(err) } };
  }

  if (err instanceof InvalidInputError) {
    return { status: 400, body: { error: err.message, errors: err.errors } };
  }

  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: err.message } };
  }

  // 401 rather than 403: the caller has not proved who they are, so the fix is to present a token
  // rather than to acquire a role. `WWW-Authenticate` is what makes it a 401 and not just a number —
  // RFC 9110 §11.6.1 requires it, and it is how a client knows which scheme to retry with.
  if (err instanceof UnauthorizedError) {
    return { status: 401, headers: { "WWW-Authenticate": "Bearer" }, body: { error: err.message } };
  }

  if (err instanceof ForbiddenError) {
    return { status: 403, body: { error: err.message } };
  }

  // 409 rather than 400: the request is well-formed and permitted, and would succeed unchanged
  // once the conflicting data is gone. Nothing for the caller to correct in the payload.
  if (err instanceof ConflictError) {
    return { status: 409, body: { error: err.message } };
  }

  return undefined;
}

interface MappedError {
  status: number;
  body: { error: string; errors?: FieldError[] };
  headers?: Record<string, string>;
}
