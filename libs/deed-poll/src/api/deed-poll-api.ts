/**
 * The seam between this app's domain functions and `deed-poll-api`.
 *
 * Two things live here and nothing else: where api is, and what a failed call means to a caller.
 * Every service module goes through `callApi`, so no other file builds an `ApiConfig` or branches on
 * an `ApiResult`.
 *
 * **The adapter does not throw and this does.** That is not a contradiction of decision 2 in
 * `docs/plans/02-dal-cutover-to-api.md`: the adapter classifies, and something above it has to decide
 * what the classification means. The decision taken is to keep the vocabulary the pages, the routes
 * and `apps/web/src/errors.ts` already map — `NotFoundError` renders the 404 page, `InvalidInputError`
 * re-renders a form with its errors against the fields — so a refusal that used to originate from a
 * Prisma-backed throw reaches exactly the same handler now that it originates from api. Task 3 of the
 * plan asks for that explicitly.
 *
 * Read from `process.env` rather than through the `config` package, matching
 * `deed-poll-web/apps/web/src/api/deed-poll-api.ts`: `config` resolves its files against the working
 * directory at IMPORT time, and `apps/web/src/app.ts` deliberately imports it only after the key
 * vault secrets have been mounted into the environment. Reading the environment lazily, per call, is
 * correct at any point in the startup sequence.
 */
import type { ApiConfig, ApiError, ApiResult } from "@hmcts/deed-poll-api-client";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthorizedError } from "../errors.js";

/** The mock api's port. `yarn mock:api` starts it there; nothing deployed relies on this default. */
const DEFAULT_BASE_URL = "http://localhost:3200";

/**
 * Who is making the call, as far as api is concerned.
 *
 * One field, and it replaces the `{ isAdmin, userName }` write context the Prisma services took: api
 * authenticates every caseworker route and derives BOTH the audit author and the admin status from
 * the token, so passing either alongside it would be a second opinion about the caller — and one this
 * app could set freely.
 *
 * Optional because `apps/api`'s routes and the unit tests both have calls with no caller to speak of.
 * A call without a token is a 401 from api rather than an unauthenticated read, which is the right way
 * for it to fail.
 */
export interface Caller {
  /** The caller's IDAM access token, presented as a bearer credential. */
  accessToken?: string;
}

/**
 * Make one api call and either return its data or throw the domain error it amounts to.
 *
 * Takes the adapter function rather than a URL so this module owns the config and the failure mapping
 * while `client.ts` keeps owning the HTTP.
 */
export async function callApi<T>(caller: Caller, call: (config: ApiConfig) => Promise<ApiResult<T>>): Promise<T> {
  const result = await call(apiConfig(caller));
  if (result.ok) return result.data;

  throw errorFor(result.error);
}

function apiConfig(caller: Caller): ApiConfig {
  const timeout = Number(process.env.DEED_POLL_API_TIMEOUT_MS);

  return {
    baseUrl: process.env.DEED_POLL_API_URL ?? DEFAULT_BASE_URL,
    // An unset or unparseable override falls back to the adapter's own default rather than to NaN,
    // which `AbortSignal.timeout` rejects outright — a bad environment variable must not take the
    // service down.
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
    accessToken: caller.accessToken
  };
}

/**
 * One classified failure as the domain error the app already renders.
 *
 * `unavailable`, `timeout`, `invalid-response` and `unknown` all become a plain `Error`, which reaches
 * the starter's 500 page. That is deliberate rather than a gap: an api this app cannot reach is a
 * fault, and the same fault a database outage was before the cutover — a bespoke error class would
 * render the identical page while inviting a handler to treat "the backend blinked" as a user's
 * problem. The message names api so the 500 is diagnosable from a log line.
 */
function errorFor(error: ApiError): Error {
  switch (error.kind) {
    case "not-found":
      return new NotFoundError(error.message);
    case "forbidden":
      return new ForbiddenError(error.message);
    case "unauthorized":
      return new UnauthorizedError(error.message);
    case "conflict":
      return new ConflictError(error.message);
    case "validation":
      // The field errors are api's, unrenamed: its property names are this app's field names, so an
      // error summary can already link to the input that caused it.
      return new InvalidInputError(error.message, [...(error.fieldErrors ?? [])]);
    default:
      return new Error(`deed-poll-api call failed (${error.kind}): ${error.message}`);
  }
}
