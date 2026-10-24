/**
 * The seam between this app's domain functions and `deed-poll-api`.
 *
 * Two things live here and nothing else: where api is, and what a failed call means to a caller.
 * Every service module goes through `callApi`, so no other file builds an `ApiConfig` or branches on
 * an `ApiResult`.
 *
 * **The adapter does not throw and this does.** That is not a contradiction of decision 2 in
 * `docs/plans/completed/02-dal-cutover-to-api.md`: the adapter classifies, and something above it has to decide
 * what the classification means. The decision taken is to keep the vocabulary the pages, the routes
 * and `src/errors.ts` already map — `NotFoundError` renders the 404 page, `InvalidInputError`
 * re-renders a form with its errors against the fields — so a refusal that used to originate from a
 * Prisma-backed throw reaches exactly the same handler now that it originates from api. Task 3 of the
 * plan asks for that explicitly.
 *
 * Read from `process.env` rather than through the `config` package, matching
 * `deed-poll-web/apps/web/src/api/deed-poll-api.ts`: `config` resolves its files against the working
 * directory at IMPORT time, and `src/app.ts` deliberately imports it only after the key
 * vault secrets have been mounted into the environment. Reading the environment lazily, per call, is
 * correct at any point in the startup sequence.
 */
import {
  type ApiConfig,
  type ApiError,
  type ApiResult,
  assertApiBaseUrl,
  checkApiReachable,
  type GazetteApiResult,
  type PreviewApiResult
} from "@hmcts/deed-poll-api-client";
import { DocumentPreviewRefusedError } from "../document-viewer/errors.js";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, TooManyRequestsError, UnauthorizedError } from "../errors.js";

import { GazetteOutcomeUnknownError, GazetteRefusalError } from "../gazette/errors.js";

/** The mock api's port. `yarn mock:api` starts it there; nothing deployed relies on this default. */
const DEFAULT_BASE_URL = "http://localhost:3200";

/** Fail startup on invalid configuration, before Redis connects or any request is served. */
export function assertDeedPollApiSettings(): void {
  try {
    assertApiBaseUrl(apiConfig({}).baseUrl);
  } catch {
    throw new Error("DEED_POLL_API_URL must be an absolute HTTP(S) URL without credentials, query or fragment");
  }
}

/**
 * How long a readiness probe waits for api's `/health/liveness` before calling it down.
 *
 * Deliberately shorter than the application timeout `apiConfig` resolves, and deliberately **not**
 * overridable by `DEED_POLL_API_TIMEOUT_MS`: a probe must answer on its own terms and never inherit a
 * caller's patience. `runChecks` in `@hmcts-cft/cloud-native-platform` is a bare `Promise.all`, so a
 * probe slower than Kubernetes' own timeout reports nothing at all — and takes the sibling Redis result
 * in `src/app.ts` down with it.
 */
const HEALTH_PROBE_TIMEOUT_MS = 2_000;

/**
 * Who is making the call, as far as api is concerned.
 *
 * One field, and it replaces the `{ isAdmin, userName }` write context the Prisma services took: api
 * authenticates every caseworker route and derives BOTH the audit author and the admin status from
 * the token, so passing either alongside it would be a second opinion about the caller — and one this
 * app could set freely.
 *
 * Optional because the unit tests have calls with no caller to speak of, and because the readiness
 * probe below has no session to read a token from. A call without a token is a 401 from api rather
 * than an unauthenticated read, which is the right way for it to fail.
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

/**
 * Only a published Gazette refusal proves non-admission; discard untrusted diagnostic prose. A 429 stays an
 * unknown outcome too: api's limiter answering does not prove an earlier attempt under the same key was not admitted.
 *
 * `limit.timeoutMs` is the time the caller has left to wait. It is a time budget, not an identity, so it travels
 * beside the `Caller` rather than on it, and it can only shorten `DEED_POLL_API_TIMEOUT_MS`, never extend it.
 */
export async function callGazetteApi<T>(caller: Caller, call: (config: ApiConfig) => Promise<GazetteApiResult<T>>, limit: CallLimit = {}): Promise<T> {
  const config = apiConfig(caller);
  const timeoutMs = shortest(config.timeoutMs, limit.timeoutMs);
  const result = await call({ ...config, timeoutMs });
  if (result.ok) return result.data;
  if (result.error.kind === "gazette-refusal") throw new GazetteRefusalError(result.error);
  if (result.error.kind === "unauthorized") throw new UnauthorizedError("Authentication required");
  if (result.error.kind === "forbidden") throw new ForbiddenError("Gazette access refused");
  throw new GazetteOutcomeUnknownError();
}

/**
 * A document preview: `callApi`'s mapping, plus api's four preview refusals as one typed error.
 *
 * A refusal is a normal viewer state, not a fault: the preview was not produced and the original download still
 * works, so the page needs api's code to choose its own `en`/`cy` sentence. Nothing of api's prose travels.
 * `signal` lets the page stop the call when the browser has gone; it never extends the configured timeout.
 */
export async function callPreviewApi<T>(caller: Caller, call: (config: ApiConfig) => Promise<PreviewApiResult<T>>, signal?: AbortSignal): Promise<T> {
  const result = await call({ ...apiConfig(caller), signal });
  if (result.ok) return result.data;
  if (result.error.kind === "preview-refused") throw new DocumentPreviewRefusedError(result.error.code, result.error.retryAfterSeconds);

  throw errorFor(withoutProse(result.error));
}

/**
 * A preview failure with api's prose replaced by its kind and status. A converter's own words can arrive in api's
 * error body, and every failure here ends in a log line (`src/errors.ts`, or the starter's 500 handler), so the
 * message is fixed and field errors are dropped: nothing on this page has a field to show them against.
 */
function withoutProse(error: ApiError): ApiError {
  const status = error.status === undefined ? "" : ` ${error.status}`;
  return { ...error, message: `document preview failed (${error.kind}${status})`, fieldErrors: [] };
}

/**
 * Whether api is answering, as a readiness check.
 *
 * This is what replaced `deedPollDatabaseChecks()` when the data access layer went — task 5 of
 * `docs/plans/completed/02-dal-cutover-to-api.md`, which asks for it in those terms. It is the same argument the
 * Postgres check made, pointed at the dependency that took its place: this app can serve no case page
 * without api, so a probe that went green while api was unreachable would have Kubernetes send traffic
 * to a pod that 500s every request.
 *
 * **Reachability, and deliberately not api's own health verdict** — `checkApiReachable` probes api's
 * liveness group, not its aggregate `/health`, so a blip in api's database does not drop every web pod
 * out of its Service and 503 the pages that never touch api. See that function for the argument.
 *
 * No `Caller`, because api's health paths are unauthenticated. So this proves reachability and says nothing
 * about whether this app's credentials work — and it cannot do better: the only token this app holds is
 * a caseworker's, in a session, and no session exists at probe time.
 *
 * **None of the `guarded`/shared-attempt machinery the Postgres check needed comes with it, and that is
 * the point rather than an omission.** That existed because `pgPool` was built with
 * `connectionTimeoutMillis` at its default of `0`: a database that stopped answering rather than
 * refusing left a query that neither resolved nor rejected, so the probe had to bound it, share the
 * outstanding attempt, and rotate it on staleness. Every call through `client.ts` carries an
 * `AbortSignal.timeout` and classifies the abort as `timeout`, so this settles by construction and
 * leaves nothing behind to share.
 *
 * Plain `Promise<"UP" | "DOWN">`, which is what `@hmcts-cft/cloud-native-platform`'s `HealthCheck`
 * returns, so the domain needs no dependency on the app framework to supply it. **Whether it is
 * readiness or liveness is the app's call, not this file's** — see `src/app.ts`, which puts it
 * on readiness only, for why.
 */
export async function deedPollApiStatus(): Promise<"UP" | "DOWN"> {
  const result = await checkApiReachable({ ...apiConfig({}), timeoutMs: HEALTH_PROBE_TIMEOUT_MS });
  if (result.ok) return "UP";

  // `HealthCheck` collapses to UP/DOWN, so the classification is logged here or lost — and being paged
  // for "readiness DOWN" with no further detail is most of the diagnosis wasted. `unavailable` and
  // `timeout` mean different things operationally: one is a service that is down, the other a service
  // that is too slow, and only one of them is fixed by waiting.
  console.error(`deed-poll-api readiness check failed (${result.error.kind}): ${result.error.message}`);
  return "DOWN";
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

function shortest(configured: number | undefined, limit: number | undefined): number | undefined {
  if (configured === undefined) return limit;
  if (limit === undefined) return configured;
  return Math.min(configured, limit);
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
    case "rate-limited":
      return new TooManyRequestsError(error.message, error.retryAfterSeconds ?? null);
    case "validation":
      // The field errors are api's, unrenamed: its property names are this app's field names, so an
      // error summary can already link to the input that caused it.
      return new InvalidInputError(error.message, [...(error.fieldErrors ?? [])]);
    default:
      return new Error(`deed-poll-api call failed (${error.kind}): ${error.message}`);
  }
}

/** How long one call may wait at most. Unset leaves the configured or the adapter's own timeout. */
export interface CallLimit {
  timeoutMs?: number;
}
