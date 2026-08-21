/**
 * Domain errors.
 *
 * The prototype threw Nest's HTTP exceptions (`NotFoundException`,
 * `BadRequestException`) straight out of its services. That put an HTTP concern in the
 * domain layer, which this repo's conventions forbid — and it would have made
 * `@nestjs/common` a dependency of this library. These are the framework-free
 * equivalents; the route and page handlers map them to status codes.
 */

/** A record that was asked for does not exist, or is not visible in the given scope. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The caller's input is not acceptable — the domain rejected it, not the transport.
 * Replaces the prototype's `BadRequestException`.
 *
 * Deliberately not called `ValidationError`: `deed-poll-validation.ts` already exports that
 * name for a per-field `{ field, message }` result from `validate()`, which is a different
 * thing — a collected, returned failure rather than a thrown one.
 */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}
