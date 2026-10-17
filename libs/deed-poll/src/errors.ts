/**
 * Domain errors.
 *
 * The prototype threw Nest's HTTP exceptions (`NotFoundException`,
 * `BadRequestException`) straight out of its services. That put an HTTP concern in the
 * domain layer, which this repo's conventions forbid — and it would have made
 * `@nestjs/common` a dependency of this library. These are the framework-free
 * equivalents; the route and page handlers map them to status codes.
 */

import type { ZodError } from "zod";

/** A record that was asked for does not exist, or is not visible in the given scope. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The caller is known but does not hold a role the operation requires.
 * Replaces the `ForbiddenException` the prototype's `RolesGuard` threw.
 *
 * Authorisation is a domain rule here, not a transport one — which role gates which
 * operation is part of the deed-poll model (see `auth/roles.ts`), so the error belongs
 * with the other domain errors even though only the apps currently throw it.
 *
 * `reason` says which gate refused, so the app's one error mapping can record the refusal as the right security
 * event. It defaults to `"api"` because that is what `callApi` raises; the app's own gates set it, along with the
 * one detail each can safely record. The details are bounded values, never the message: the message is free text
 * for the log.
 */
export class ForbiddenError extends Error {
  readonly reason: ForbiddenReason;
  readonly requiredCapability?: string;
  readonly fetchSite?: string;
  readonly originHost?: string;

  constructor(message: string, details: ForbiddenDetails = {}) {
    super(message);
    this.name = "ForbiddenError";
    this.reason = details.reason ?? "api";
    this.requiredCapability = details.requiredCapability;
    this.fetchSite = details.fetchSite;
    this.originHost = details.originHost;
  }
}

export type ForbiddenReason = "role" | "same-origin" | "api";

export interface ForbiddenDetails {
  reason?: ForbiddenReason;
  requiredCapability?: string;
  fetchSite?: string;
  originHost?: string;
}

/**
 * The caller is not identified at all — no credential, or one that does not hold up.
 *
 * The distinction from `ForbiddenError` is the one HTTP draws between 401 and 403, and it is worth
 * keeping: a 401 tells the caller to present a credential, a 403 tells them theirs will never be
 * enough for this operation. Collapsing the two sends a caseworker whose token has simply expired to
 * ask for a role they already have.
 *
 * Introduced with bearer-token authentication in `apps/api`. Nothing in the domain throws it — the
 * same as `ForbiddenError` when it was added — but it belongs with the others so both apps map one
 * vocabulary of failure rather than inventing their own.
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * The request is well-formed and permitted, but the current state of the data forbids it.
 *
 * Distinct from `InvalidInputError` because nothing about the input is wrong: raising a referral
 * on a case that already has one open is a perfectly good request, and the identical one succeeds
 * once that referral is closed or withdrawn. That is a 409, not a 400 — the caller should act on
 * the state, not correct a field.
 *
 * **A handler is expected to catch it.** api answers 409 for the two referral transitions a
 * caseworker can lose a race on — raising a second live referral, and withdrawing one somebody
 * else has already finished with — and both are rendered as ordinary page states
 * (`src/pages/deed-polls/[id]/referrals/new.ts`, `.../[referralId]/withdraw.ts`). So it is
 * deliberately unmapped in `src/errors.ts`'s `domainErrorHandler`: a 409 reaching the 500 page
 * means a handler did not catch one it should have.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * An abuse limit refused the caller — api's, or this app's own in front of it.
 *
 * Not a plain `Error`, because the 500 page would tell a caseworker the service has broken when it is
 * asking them to wait. `retryAfterSeconds` is `null` when the wait is not known.
 */
export class TooManyRequestsError extends Error {
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = "TooManyRequestsError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A failure addressed to a specific field, so a form can render it in place. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * The caller's input is not acceptable — the domain rejected it, not the transport.
 * Replaces the prototype's `BadRequestException`.
 *
 * Carries the per-field failures as well as a summary message. That is not decoration: the
 * prototype threw `BadRequestException({ message, errors })` and the SSR forms render those
 * `errors` against the individual inputs. A message-only error would have quietly downgraded
 * every field-level validation failure to an unattributed one.
 *
 * Deliberately not called `ValidationError`: `deed-poll-validation.ts` already exports that
 * name for a per-field result from `validate()`, which is a collected-and-returned failure
 * rather than a thrown one.
 */
export class InvalidInputError extends Error {
  readonly errors: FieldError[];

  constructor(message: string, errors: FieldError[] = []) {
    super(message);
    this.name = "InvalidInputError";
    this.errors = errors;
  }
}

/**
 * Flatten a `ZodError` into the same `FieldError[]` an `InvalidInputError` carries, so a
 * schema rejection and a domain rejection are indistinguishable to whatever renders them.
 * Without this the two arrive in different shapes and the caller needs two code paths.
 *
 * Nested and indexed paths are dotted (`["witnesses", 0, "name"]` → `witnesses.0.name`).
 * An issue with an empty path — a `.refine()` on the object as a whole — yields an empty
 * `field`, which callers should treat as addressed to the form rather than to an input.
 */
export function zodErrorToFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message
  }));
}
