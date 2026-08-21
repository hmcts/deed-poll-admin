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
